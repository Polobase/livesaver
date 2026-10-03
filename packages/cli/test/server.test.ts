/** The web app's server: the page's files, and an API only the page it served may use. */
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { join } from 'node:path'
import { Inventory } from '@livesaver/plugins'
import { copyFixtures, tempDir, writeFile } from '@livesaver/test-kit'
import {
  TOKEN_HEADER,
  type WebEvent,
  type WebInfo,
  type WebLastScan,
  type WebRun,
  type WebRunDetail,
  type WebStatus,
} from '../src/web/protocol.js'
import { startWeb, type WebServer } from '../src/web/server.js'

let tmp: { path: string; cleanup: () => void }
let projects: string
let samples: string
let server: WebServer
let revealed: string[]
const saved = { home: process.env.LIVESAVER_HOME, trash: process.env.LIVESAVER_TRASH_DIR }

beforeEach(async () => {
  tmp = tempDir()
  ;({ projects, samples } = copyFixtures(tmp.path))
  process.env.LIVESAVER_HOME = join(tmp.path, 'home')
  process.env.LIVESAVER_TRASH_DIR = join(tmp.path, 'trash')
  const config = join(tmp.path, 'config.json')
  writeFileSync(
    config,
    JSON.stringify({ appResources: '', vendorLibraries: [], searchRoots: [samples] }),
  )
  const assets = join(tmp.path, 'assets')
  writeFile(
    join(assets, 'index.html'),
    '<!doctype html><meta name="livesaver-local" content="" /><script src="./main.js"></script>',
  )
  writeFile(join(assets, 'main.js'), 'console.log(1)')
  revealed = []
  server = await startWeb({
    assets,
    config,
    liveRunning: () => false,
    // Nothing of this computer: no plug-in is installed, and no window is opened.
    plugins: async () => ({ inventory: new Inventory([]), catalog: new Map() }),
    reveal: async (path) => {
      revealed.push(path)
    },
  })
})
afterEach(async () => {
  await server.close()
  tmp.cleanup()
  for (const [key, value] of [
    ['LIVESAVER_HOME', saved.home],
    ['LIVESAVER_TRASH_DIR', saved.trash],
  ] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

interface Answer {
  readonly status: number
  readonly type: string
  readonly text: string
}

/** A request with exactly these headers (`fetch` would not let a test set Host or Origin). */
function ask(
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: server.port,
        path,
        method: options.method ?? 'GET',
        headers: { host: `127.0.0.1:${server.port}`, ...options.headers },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            type: String(res.headers['content-type']),
            text: Buffer.concat(chunks).toString('utf8'),
          }),
        )
      },
    )
    req.on('error', reject)
    if (options.body !== undefined) req.write(JSON.stringify(options.body))
    req.end()
  })
}

const own = () => ({ [TOKEN_HEADER]: server.token })

test('the page is served with the token, its files as they are, nothing beside them', async () => {
  const page = await ask('/')
  expect([page.status, page.type]).toEqual([200, 'text/html; charset=utf-8'])
  expect(page.text).toContain(`name="livesaver-local" content="${server.token}"`)
  const script = await ask('/main.js')
  expect([script.status, script.type, script.text]).toEqual([
    200,
    'text/javascript; charset=utf-8',
    'console.log(1)',
  ])
  expect((await ask('/nothing.js')).status).toBe(404)
  expect((await ask('/..%2Fconfig.json')).status).toBe(404)
  expect((await ask('/', { method: 'POST' })).status).toBe(405)
})

test('only the page that was served may ask: token, address and origin must be its own', async () => {
  expect((await ask('/api/info')).status).toBe(403)
  expect((await ask('/api/info', { headers: { [TOKEN_HEADER]: 'guess' } })).status).toBe(403)
  // Another site whose name points at this computer.
  expect((await ask('/api/info', { headers: { ...own(), host: 'evil.example' } })).status).toBe(403)
  expect(
    (await ask('/api/info', { headers: { ...own(), origin: 'https://evil.example' } })).status,
  ).toBe(403)
  const fromPage = { ...own(), origin: `http://127.0.0.1:${server.port}` }
  expect((await ask('/api/info', { headers: fromPage })).status).toBe(200)
  const byName = { ...own(), host: `localhost:${server.port}` }
  expect((await ask('/api/info', { headers: byName })).status).toBe(200)
  expect((await ask('/api/fix', { method: 'POST', body: {} })).status).toBe(403)
})

test('a development server may stand in front: its address is allowed, the token still needed', async () => {
  const front = 'http://localhost:5173'
  const api = await startWeb({ assets: false, origins: [front] })
  const get = (headers: Record<string, string>) =>
    fetch(`${api.url}api/info`, { headers }).then((answer) => answer.status)
  try {
    expect(await get({ [TOKEN_HEADER]: api.token, origin: front })).toBe(200)
    expect(await get({ origin: front })).toBe(403)
    expect(await get({ [TOKEN_HEADER]: api.token, origin: 'http://localhost:9999' })).toBe(403)
    // It serves no page itself.
    expect((await fetch(api.url)).status).toBe(404)
  } finally {
    await api.close()
  }
})

test('a page that goes away in the middle of a run does not stop the server', async () => {
  const request = {
    projects: [projects],
    search: [{ path: samples, vendor: false }],
    options: { packLimitMB: 50, matchLibraryPath: false },
  }
  // The request is cut as soon as the first line of the answer arrives.
  await new Promise<void>((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: server.port,
        path: '/api/check',
        method: 'POST',
        headers: { host: `127.0.0.1:${server.port}`, ...own() },
      },
      (res) => {
        res.once('data', () => {
          req.destroy()
          resolve()
        })
      },
    )
    req.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ECONNRESET') reject(error)
    })
    req.end(JSON.stringify(request))
  })
  // The run goes on to its end; until then another one is refused, afterwards it is taken.
  let status = 409
  for (let tries = 0; status === 409 && tries < 100; tries++) {
    const next = await ask('/api/check', { method: 'POST', headers: own(), body: request })
    status = next.status
    if (status === 409) await new Promise((wait) => setTimeout(wait, 50))
  }
  expect(status).toBe(200)
  expect((await ask('/api/check', { method: 'POST', headers: own(), body: {} })).text).toContain(
    'The request names no folders or options.',
  )
})

test('the page gets what it starts with, folders to choose from, and a check line by line', async () => {
  const info = JSON.parse((await ask('/api/info', { headers: own() })).text) as WebInfo
  expect(info.search.map((folder) => folder.path)).toEqual([samples])
  const listing = await ask(`/api/folders?path=${encodeURIComponent(tmp.path)}`, { headers: own() })
  // `home` is livesaver's own folder: the server makes it when it starts.
  expect(JSON.parse(listing.text).folders.map((f: { name: string }) => f.name)).toEqual([
    'assets',
    'home',
    'projects',
    'samples',
  ])
  const missing = await ask('/api/folders?path=%2Fnot%2Fthere', { headers: own() })
  expect(missing.status).toBe(200)
  expect(JSON.parse(missing.text).problem).toContain('/not/there')

  const check = await ask('/api/check', {
    method: 'POST',
    headers: own(),
    body: {
      projects: [projects],
      search: [{ path: samples, vendor: false }],
      options: { packLimitMB: 50, matchLibraryPath: false },
    },
  })
  expect([check.status, check.type]).toEqual([200, 'application/x-ndjson'])
  const events = check.text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as WebEvent)
  const last = events.at(-1)
  expect(last?.type).toBe('done')
  expect(last?.type === 'done' && [last.result.sets, last.result.changingSets]).toEqual([3, 1])
  expect((await ask('/api/unknown', { headers: own() })).status).toBe(404)
})

test('a scan is kept until something is written, and the history tells what was', async () => {
  const get = async <T>(path: string) => JSON.parse((await ask(path, { headers: own() })).text) as T
  const post = (path: string, body: unknown) => ask(path, { method: 'POST', headers: own(), body })
  const request = {
    projects: [projects],
    search: [{ path: samples, vendor: false }],
    options: { packLimitMB: 50, matchLibraryPath: false },
  }
  // Whether Live runs is what the server is told here, not what runs on the machine of the test.
  expect(await get<WebStatus>('/api/status')).toMatchObject({
    busy: '',
    lastScan: '',
    liveRunning: false,
  })
  expect(await get<object>('/api/scan')).toEqual({})

  const scanned = await post('/api/scan', request)
  const last = JSON.parse(scanned.text.trim().split('\n').at(-1) as string) as WebEvent
  expect(last.type).toBe('scanned')
  // A page that is opened again gets the same scan without scanning.
  const kept = await get<WebLastScan>('/api/scan')
  expect(kept.request).toEqual(request)
  expect(last.type === 'scanned' && kept.scan).toEqual(last.type === 'scanned' && last.scan)
  expect((await get<WebStatus>('/api/status')).lastScan).toBe(kept.at)
  expect([kept.scan.samples.changingSets, kept.scan.plugins.inventory]).toEqual([1, true])
  // Nothing of Live is known here, so an upgrade cannot be planned; the answer says why.
  const planned = await post('/api/upgrade/plan', { projects: [projects] })
  expect(JSON.parse(planned.text.trim().split('\n').at(-1) as string)).toEqual({
    type: 'failed',
    message: "No VST3 plug-ins in Live's plug-in database.",
  })

  const fixed = await post('/api/fix', request)
  const fix = JSON.parse(fixed.text.trim().split('\n').at(-1) as string) as WebEvent
  expect(fix.type === 'fixed' && [fix.fixed.sets, fix.fixed.files]).toEqual([1, 1])
  expect(await get<object>('/api/scan')).toEqual({})

  // An undo that cannot be done answers with why, as a fix does: it is no fault of the request.
  const refused = await post('/api/undo', { run: 'no-such-run' })
  expect([refused.status, JSON.parse(refused.text)]).toEqual([
    200,
    { problem: 'This is not a run that changed anything: no-such-run' },
  ])

  const runs = await get<WebRun[]>('/api/runs')
  expect(runs.map((run) => [run.command, run.state, run.sets, run.files])).toEqual([
    ['collect', 'applied', 1, 1],
  ])
  const id = runs[0]?.id as string
  const detail = await get<WebRunDetail>(`/api/runs/${id}`)
  expect(detail.steps.map((step) => step.op)).toEqual(['copy', 'write-set'])
  expect(detail.run.reports).toContain('changes.csv')
  const report = await ask(`/api/runs/${id}/reports/changes.csv`, { headers: own() })
  expect([report.status, report.type]).toEqual([200, 'text/plain; charset=utf-8'])
  expect(report.text).toContain('1.wav')
  const none = await ask(`/api/runs/${id}/reports/journal.jsonl`, { headers: own() })
  expect([none.status, JSON.parse(none.text).message]).toEqual([
    400,
    'The run has no such report: journal.jsonl',
  ])
  expect((await ask('/api/runs/nothing', { headers: own() })).status).toBe(400)

  const set = detail.steps[1]?.path as string
  expect((await post('/api/reveal', { path: set })).status).toBe(200)
  expect(revealed).toEqual([set])
  expect((await post('/api/reveal', { path: join(tmp.path, 'gone') })).status).toBe(400)
  expect((await get<WebInfo>('/api/info')).reveal).toBe(true)
})

test('a reset forgets the folders of the last scan, but not while something runs', async () => {
  const get = async <T>(path: string) => JSON.parse((await ask(path, { headers: own() })).text) as T
  const post = (path: string, body: unknown) => ask(path, { method: 'POST', headers: own(), body })
  const request = {
    projects: [projects],
    search: [],
    options: { packLimitMB: 7, matchLibraryPath: true },
  }
  // A scan is started and, while it runs, a reset is refused.
  const scan = post('/api/scan', request)
  let refused = 0
  for (let tries = 0; tries < 200 && refused === 0; tries++) {
    const { busy } = await get<WebStatus>('/api/status')
    if (busy === 'scan') refused = (await post('/api/reset', {})).status
    else await new Promise((wait) => setTimeout(wait, 5))
  }
  expect(refused).toBe(409)
  await scan
  const kept = await get<WebInfo>('/api/info')
  expect([kept.projects, kept.search, kept.options.packLimitMB]).toEqual([[projects], [], 7])
  expect(kept.found.remembered).toBe(true)

  expect((await post('/api/reset', {})).status).toBe(200)
  const reset = await get<WebInfo>('/api/info')
  expect([reset.projects, reset.options]).toEqual([
    [],
    { packLimitMB: 50, matchLibraryPath: false },
  ])
  expect(reset.search.map((folder) => folder.path)).toEqual([samples])
  expect(reset.found.remembered).toBe(false)
  // The scan itself is kept: it is still what was found in the folders it names.
  expect((await get<WebLastScan>('/api/scan')).request).toEqual(request)
})
