/**
 * The web app served from this computer: the page's files, and what the page asks of livesaver
 * (`local.ts`). It listens on this computer only, and since it can write, every request must
 * carry the token of the page it served: no other page in the browser can ask it for anything.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stateDir } from '../state.js'
import {
  liveRuns,
  type WebSettings,
  webCheck,
  webFix,
  webFolders,
  webInfo,
  webReset,
  webUndo,
} from './local.js'
import { canReveal, freeBytesAt, webReport, webReveal, webRun, webRuns } from './local-runs.js'
import { type ScanNotes, webScan, webUpgrade, webUpgradePlan } from './local-scan.js'
import {
  TOKEN_HEADER,
  TOKEN_META,
  type WebEvent,
  type WebFixRequest,
  type WebLastScan,
  type WebRequest,
  type WebStatus,
  type WebUpgradeRequest,
} from './protocol.js'

export interface WebServerOptions extends WebSettings {
  /** 0 = any free port. */
  readonly port?: number
  /** The folder with the built page; found next to this file if not given. `false`: no page. */
  readonly assets?: string | false
  /**
   * Other addresses a page may come from, e.g. `http://localhost:5173` when a development
   * server serves the page and passes its requests on. They need the token all the same.
   */
  readonly origins?: readonly string[]
}

export interface WebServer {
  readonly url: string
  readonly port: number
  /** The token the served page carries (for tests that talk to the server themselves). */
  readonly token: string
  close(): Promise<void>
}

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

/** The built page: shipped with the package, or in the repository when run from source. */
export function findAssets(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const places = [
    join(here, '..', 'web-app'),
    join(here, '..', '..', '..', '..', 'apps', 'web', 'dist'),
  ]
  const found = places.find((place) => existsSync(join(place, 'index.html')))
  if (!found) throw new Error('The web app is not built (run `bun run build`).')
  return found
}

function send(res: ServerResponse, status: number, body: string | Uint8Array, type: string) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(body)
}

const json = (res: ServerResponse, status: number, value: unknown) =>
  send(res, status, JSON.stringify(value), 'application/json')

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > 1_000_000) throw new Error('request too large')
    chunks.push(chunk as Buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

export async function startWeb(options: WebServerOptions = {}): Promise<WebServer> {
  const assets = options.assets === false ? '' : (options.assets ?? findAssets())
  // The page says where livesaver keeps its runs, and shows the folder: it is there from now on.
  mkdirSync(stateDir(), { recursive: true })
  const token = randomBytes(24).toString('hex')
  let port = options.port ?? 0
  /** One run at a time: a check reads what a fix writes. What runs, and how far it is. */
  let busy: WebStatus['busy'] = ''
  let progress: Pick<WebStatus, 'phase' | 'done' | 'total'> = {}
  /** The last scan is kept: a page that is reloaded, or opened again, shows it without scanning. */
  let lastScan: WebLastScan | undefined
  let notes: ScanNotes | undefined
  const forget = () => {
    lastScan = undefined
    notes = undefined
  }

  /** Only the page this server served may ask: it has the token, and it came from this address. */
  const allowed = (req: IncomingMessage) => {
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`]
    const origin = req.headers.origin
    return (
      req.headers[TOKEN_HEADER] === token &&
      hosts.includes(req.headers.host ?? '') &&
      (origin === undefined ||
        hosts.some((host) => origin === `http://${host}`) ||
        (options.origins ?? []).includes(origin))
    )
  }

  const BUSY = 'Another scan or fix is still running.'

  /** A run answers line by line, so the page can show how far it is. */
  const stream = async (
    res: ServerResponse,
    kind: Exclude<WebStatus['busy'], ''>,
    run: (emit: (event: WebEvent) => void) => Promise<void>,
  ) => {
    if (busy) return json(res, 409, { message: BUSY })
    busy = kind
    progress = {}
    // What a scan found is no longer true once something is written.
    if (kind === 'fix' || kind === 'upgrade') forget()
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' })
    // The page may be gone before the run ends (closed, reloaded): the run finishes all the
    // same, since a fix must not stop half-way, and its lines go nowhere.
    res.on('error', () => {})
    try {
      await run((event) => {
        if (event.type === 'phase') progress = { phase: event.phase }
        else if (event.type === 'progress')
          progress = { ...progress, done: event.done, total: event.total }
        if (!res.destroyed) res.write(`${JSON.stringify(event)}\n`)
      })
    } finally {
      busy = ''
      progress = {}
      if (!res.destroyed) res.end()
    }
  }

  const status = async (path: string): Promise<WebStatus> => {
    const freeBytes = await freeBytesAt(path)
    return {
      liveRunning: liveRuns(options),
      busy,
      ...progress,
      lastScan: lastScan?.at ?? '',
      ...(freeBytes === undefined ? {} : { freeBytes }),
    }
  }

  const api = async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    if (!allowed(req)) return json(res, 403, { message: 'not allowed' })
    const route = `${req.method} ${url.pathname}`
    if (route === 'GET /api/info')
      return json(res, 200, { ...(await webInfo(options)), reveal: canReveal(options) })
    if (route === 'GET /api/folders') {
      // A path that cannot be opened is an answer, not a failure: paths are typed by hand.
      try {
        return json(res, 200, webFolders(url.searchParams.get('path') ?? ''))
      } catch (error) {
        return json(res, 200, { problem: (error as Error).message })
      }
    }
    if (route === 'POST /api/reset') {
      // A scan that runs notes its folders when it ends: they would be back at once.
      if (busy) return json(res, 409, { message: BUSY })
      webReset()
      return json(res, 200, {})
    }
    if (route === 'GET /api/status')
      return json(res, 200, await status(url.searchParams.get('path') ?? ''))
    if (route === 'POST /api/check') {
      const request = (await body(req)) as WebRequest
      return stream(res, 'check', (emit) => webCheck(request, emit, options))
    }
    if (route === 'GET /api/scan') return json(res, 200, lastScan ?? {})
    if (route === 'POST /api/scan') {
      const request = (await body(req)) as WebRequest
      return stream(res, 'scan', async (emit) => {
        notes = await webScan(
          request,
          (event) => {
            if (event.type === 'scanned') lastScan = { scan: event.scan, request, at: event.at }
            emit(event)
          },
          options,
        )
      })
    }
    if (route === 'POST /api/upgrade/plan') {
      const request = (await body(req)) as WebUpgradeRequest
      // What the scan learned holds for a plan of the folders it scanned, or of one of them.
      const scanned = lastScan
      const known =
        scanned !== undefined &&
        JSON.stringify(request.projects) === JSON.stringify(scanned.request.projects)
      const whole = known && ![request.only ?? []].flat().length && !request.plugins?.length
      return stream(res, 'plan', (emit) =>
        webUpgradePlan(
          request,
          (event) => {
            if (event.type === 'planned' && whole && lastScan === scanned)
              lastScan = { ...scanned, upgrade: event.upgrade }
            emit(event)
          },
          options,
          known ? notes : undefined,
        ),
      )
    }
    if (route === 'POST /api/fix') {
      const request = (await body(req)) as WebFixRequest
      return stream(res, 'fix', (emit) => webFix(request, emit, options))
    }
    if (route === 'POST /api/upgrade') {
      const request = (await body(req)) as WebUpgradeRequest
      return stream(res, 'upgrade', (emit) => webUpgrade(request, emit, options))
    }
    if (route === 'POST /api/undo') {
      if (busy) return json(res, 409, { message: BUSY })
      busy = 'undo'
      forget()
      try {
        const { run } = (await body(req)) as { run?: string }
        // An undo that is refused (Live runs, the run is not there) is an answer, like a fix
        // that fails: the page says why.
        return json(
          res,
          200,
          await webUndo(String(run ?? ''), options).catch((error: unknown) => ({
            problem: (error as Error).message || String(error),
          })),
        )
      } finally {
        busy = ''
      }
    }
    if (route === 'GET /api/runs') return json(res, 200, await webRuns())
    const run = /^GET \/api\/runs\/([^/]+)(?:\/reports\/([^/]+))?$/.exec(route)
    if (run) {
      const id = decodeURIComponent(run[1] as string)
      if (run[2] === undefined) return json(res, 200, await webRun(id))
      const text = webReport(id, decodeURIComponent(run[2]))
      return send(res, 200, text, 'text/plain; charset=utf-8')
    }
    if (route === 'POST /api/reveal') {
      const { path } = (await body(req)) as { path?: string }
      await webReveal(String(path ?? ''), options)
      return json(res, 200, {})
    }
    return json(res, 404, { message: 'not found' })
  }

  const page = async (res: ServerResponse, pathname: string) => {
    if (!assets) return send(res, 404, 'not found', 'text/plain')
    const name = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1))
    const path = normalize(join(assets, name))
    if (!path.startsWith(assets + sep)) return send(res, 404, 'not found', 'text/plain')
    if (!existsSync(path) || !statSync(path).isFile())
      return send(res, 404, 'not found', 'text/plain')
    const type = TYPES[extname(path)] ?? 'application/octet-stream'
    if (name !== 'index.html') return send(res, 200, readFileSync(path), type)
    // The page learns from its own HTML that livesaver serves it, and with which token.
    const html = readFileSync(path, 'utf8').replace(
      `name="${TOKEN_META}" content=""`,
      `name="${TOKEN_META}" content="${token}"`,
    )
    return send(res, 200, html, type)
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const answer = url.pathname.startsWith('/api/')
      ? api(req, res, url)
      : req.method === 'GET'
        ? page(res, url.pathname)
        : Promise.resolve(send(res, 405, 'not allowed', 'text/plain'))
    answer.catch((error: unknown) => {
      const message = (error as Error).message || String(error)
      if (res.headersSent) res.end()
      else json(res, 400, { message })
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}/`,
    port,
    token,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
