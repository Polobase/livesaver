/**
 * One contract, two engines. Every scenario here runs against livesaver on this computer (a real
 * server on a temporary copy of the fixtures) and against the browser's engine (on this thread,
 * with folders as a page gets them), so a screen that works with one works with the other.
 * What only one of them can do is tested below, and that the other refuses it.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Catalog, type CatalogEntry, Inventory } from '@livesaver/plugins'
import { copyFixtures, tempDir, uploadedFolder, writeFile } from '@livesaver/test-kit'
import { localEngineWorker } from '@livesaver/web'
import { startWeb, type WebServer } from 'livesaver'
import {
  BrowserEngine,
  type Capabilities,
  ComputerEngine,
  type Engine,
  folderAt,
  type Progress,
  RunFailed,
  type Scan,
  type ScanRequest,
  Unreachable,
  Unsupported,
} from '../src/engine/index.js'

const MASSIVE_VST3 = '5653544e694d616d6173736976650000'
const SERUM_VST3 = '56535458667358736572756d00000000'
const CATALOG: Catalog = new Map<string, CatalogEntry>([
  [MASSIVE_VST3, { devIdentifier: `device:vst3:instr:${MASSIVE_VST3}`, name: 'Massive' }],
  [SERUM_VST3, { devIdentifier: `device:vst3:instr:${SERUM_VST3}`, name: 'Serum' }],
])

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
  revealed = []
  server = await startWeb({
    assets: false,
    config,
    liveRunning: () => false,
    version: '1.2.3',
    plugins: async () => ({ inventory: new Inventory([]), catalog: CATALOG }),
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

interface Setup {
  readonly engine: Engine
  readonly request: ScanRequest
}

const OPTIONS = { packLimitMB: 50, matchLibraryPath: false }

function computer(): Setup {
  const engine = new ComputerEngine({ token: server.token, base: server.url })
  return {
    engine,
    request: { projects: [folderAt(projects)], search: [folderAt(samples)], options: OPTIONS },
  }
}

function browser(): Setup & { readonly engine: BrowserEngine } {
  const engine = new BrowserEngine({ spawn: () => localEngineWorker({ cores: 4 }) })
  return {
    engine,
    request: {
      projects: [engine.add(uploadedFolder(projects), 'projects')],
      search: [engine.add(uploadedFolder(samples), 'search')],
      options: OPTIONS,
    },
  }
}

const ENGINES = [
  ['on this computer', computer],
  ['in the browser', browser],
] as const

/** What a scan puts on the screen, without what an engine may see differently (where things lie). */
function shown(scan: Scan) {
  const s = scan.samples
  return {
    totals: [s.projects, s.completeProjects, s.sets, s.completeSets, s.changingSets],
    counts: s.counts,
    copies: [s.copyFiles, s.copyBytes, s.uncertain],
    certain: s.certain,
    projects: s.projectRows.map(({ root: _root, ...row }) => row),
    sets: s.setRows,
    changes: s.changes.map(({ source: _source, ...change }) => change),
    missing: s.missing.map(({ candidates: _candidates, ...row }) => row),
    reports: Object.keys(s.reports).sort(),
    plugins: scan.plugins.uses
      .map((use) => [use.name, use.format, use.code, use.instances, use.sets, use.projects])
      .sort(),
    pluginTotals: [scan.plugins.sets, scan.plugins.projects, scan.plugins.counts.used],
  }
}

for (const [where, setup] of ENGINES) {
  describe(`the engine ${where}`, () => {
    test('says what it starts with', async () => {
      const { engine } = setup()
      const start = await engine.start()
      expect(start.options).toEqual(OPTIONS)
      expect(Array.isArray(start.projects) && Array.isArray(start.search)).toBe(true)
      expect(start.last).toBeUndefined()
    })

    test('scans: how far it is as it goes, then the samples and the plug-ins', async () => {
      const { engine, request } = setup()
      const progress: Progress[] = []
      const scan = await engine.scan(request, (event) => progress.push(event))

      const phases = progress.flatMap((event) => (event.type === 'phase' ? [event.phase] : []))
      expect(phases.filter((phase) => phase !== 'locating' && phase !== 'plugins')).toEqual([
        'indexing',
        'checking',
        'reporting',
      ])
      // The samples of the sample folder, and the one a project has already.
      expect(progress.filter((event) => event.type === 'indexed')).toEqual([
        { type: 'indexed', files: 3 },
      ])
      const sets = progress.flatMap((event) => (event.type === 'progress' ? [event] : []))
      expect(sets.map((event) => [event.done, event.total])).toEqual([
        [1, 3],
        [2, 3],
        [3, 3],
      ])
      expect(sets.map((event) => event.name)).toEqual([
        'Brokenpath.als',
        'Fixed Path.als',
        'VST2toVST3.als',
      ])

      expect(shown(scan)).toMatchObject({
        totals: [3, 3, 3, 3, 1],
        counts: { ok: 1, found: 1, 'not-found': 0 },
        copies: [1, 2000324, 0],
        certain: { changingSets: 1, changes: 1, copyFiles: 1, copyBytes: 2000324 },
        pluginTotals: [3, 3, 6],
      })
      expect(Number.isNaN(Date.parse(scan.at))).toBe(false)
      expect(Object.values(scan.seconds).every((seconds) => seconds >= 0)).toBe(true)
      // What is installed is known to the one, and unknown to the other.
      expect(scan.plugins.inventory).toBe(engine.capabilities.installedPlugins)
    })

    test('a scan that cannot run rejects with what to show', async () => {
      const { engine, request } = setup()
      const failed = await engine.scan({ ...request, projects: [] }).then(
        () => undefined,
        (error: unknown) => error,
      )
      expect(failed).toBeInstanceOf(RunFailed)
      expect((failed as RunFailed).message.length).toBeGreaterThan(5)
    })

    test('what it cannot do, it refuses as such; what it can, it does not refuse', async () => {
      const { engine, request } = setup()
      await engine.start()
      const folders = { projects: request.projects }
      const asked: Record<keyof Capabilities, (() => Promise<unknown>)[]> = {
        paths: [() => engine.folders(tmp.path)],
        fix: [() => engine.fix({ ...request, only: [join(projects, 'Fixed Path Project')] })],
        upgrade: [() => engine.planUpgrade(folders)],
        undo: [() => engine.undo('no-such-run')],
        history: [() => engine.run('no-such-run'), () => engine.report('no-such-run', 'x.csv')],
        reveal: [() => engine.reveal(projects)],
        installedPlugins: [],
        liveStatus: [],
        keepsScan: [],
        ownSettings: [() => engine.reset()],
      }
      for (const [capability, calls] of Object.entries(asked)) {
        for (const call of calls) {
          const outcome = await call().then(
            () => 'done',
            (error: unknown) => (error instanceof Unsupported ? 'unsupported' : 'failed'),
          )
          const can = engine.capabilities[capability as keyof Capabilities]
          // A run that does not exist fails, but not for want of the ability.
          expect([capability, outcome === 'unsupported']).toEqual([capability, !can])
        }
      }
      // Neither engine fails where there is nothing: an empty history, a state of rest.
      expect(await engine.runs()).toEqual(engine.capabilities.history ? expect.any(Array) : [])
      expect(await engine.status()).toMatchObject({ busy: '', liveRunning: expect.any(Boolean) })
    })
  })
}

test('both engines show the same for the same library', async () => {
  const a = computer()
  const b = browser()
  const onComputer = shown(await a.engine.scan(a.request))
  const inBrowser = shown(await b.engine.scan(b.request))
  expect(inBrowser).toEqual(onComputer)
})

describe('only livesaver on this computer', () => {
  test('keeps the scan for a page that is opened again', async () => {
    const { engine, request } = computer()
    const scan = await engine.scan(request)
    const again = new ComputerEngine({ token: server.token, base: server.url })
    const start = await again.start()
    expect(start.version).toBe('1.2.3')
    expect(start.last?.scan).toEqual(scan)
    expect(start.last?.request).toEqual(request)
    // The folders of the scan are what the app starts with from now on.
    expect(start.projects).toEqual(request.projects)
    expect(start.search.map((folder) => [folder.path, folder.exists])).toEqual([[samples, true]])
    expect(again.capabilities.reveal).toBe(true)
    // Where things are on this computer; and the folders are those of the scan until a reset.
    expect(start.found).toMatchObject({
      config: join(tmp.path, 'config.json'),
      state: join(tmp.path, 'home'),
      remembered: true,
    })
    const reset = await again.reset()
    expect([reset.projects, reset.found?.remembered]).toEqual([[], false])
    expect(reset.search.map((folder) => folder.path)).toEqual([samples])
    // The scan is of the folders it names, whatever the app starts with: it is kept.
    expect(reset.last?.request).toEqual(request)
  })

  test('plans an upgrade, and remembers the plan with the scan', async () => {
    const { engine, request } = computer()
    await engine.scan(request)
    const progress: Progress[] = []
    const plan = await engine.planUpgrade({ projects: request.projects }, (e) => progress.push(e))
    expect([plan.sets, plan.changingSets]).toEqual([3, 1])
    expect(plan.plugins.map((p) => [p.plugin, p.convertibleInstances])).toEqual([
      ['Massive', 1],
      ['Omnisphere', 0],
      ['Serum', 1],
    ])
    expect(progress[0]).toEqual({ type: 'phase', phase: 'plugins' })
    expect((await engine.start()).last?.upgrade).toEqual(plan)
  })

  test('fixes, with the uncertain matches or without, and takes it back', async () => {
    const { engine, request } = computer()
    const scan = await engine.scan(request)
    const set = join(projects, 'Brokenpath Project', 'Brokenpath.als')
    const before = readFileSync(set)
    const project = scan.samples.projectRows.find((row) => row.changingSets > 0)
    const progress: Progress[] = []
    const fixed = await engine.fix(
      { ...request, only: [project?.root as string], certainOnly: true },
      (event) => progress.push(event),
    )
    expect([fixed.sets, fixed.files, fixed.bytes, fixed.errors]).toEqual([1, 1, 2000324, []])
    expect(progress.some((event) => event.type === 'phase' && event.phase === 'fixing')).toBe(true)
    expect(readFileSync(set)).not.toEqual(before)
    // What was scanned is no longer true, so it is not kept.
    expect((await engine.start()).last).toBeUndefined()

    const [run] = await engine.runs()
    expect(run).toMatchObject({ id: fixed.run, command: 'collect', state: 'applied', sets: 1 })
    expect(run?.record?.options).toMatchObject({ certainOnly: true })
    const detail = await engine.run(fixed.run)
    expect(detail.steps.map((step) => step.op)).toEqual(['copy', 'write-set'])
    expect(await engine.report(fixed.run, 'changes.csv')).toContain('1.wav')
    await engine.reveal(set)
    expect(revealed).toEqual([set])
    // Before a fix the page says whether the copies fit: free space where the projects lie.
    expect((await engine.status(projects)).freeBytes).toBeGreaterThan(1_000_000)
    expect((await engine.status()).freeBytes).toBeUndefined()

    const undone = await engine.undo(fixed.run)
    expect([undone.restored, undone.trashed, undone.problems]).toEqual([1, 2, []])
    expect(readFileSync(set)).toEqual(before)
    expect((await engine.runs())[0]).toMatchObject({ state: 'undone', canUndo: false })
  })

  test('upgrades plug-ins and takes it back', async () => {
    const { engine, request } = computer()
    const set = join(projects, 'VST2toVST3 Project', 'VST2toVST3.als')
    const before = readFileSync(set)
    const upgraded = await engine.upgrade({ projects: request.projects, plugins: ['Serum'] })
    expect([upgraded.sets, upgraded.errors]).toEqual([1, []])
    expect(upgraded.upgrade.rows.map((row) => [row.plugin, row.converted, row.written])).toEqual([
      ['Serum', true, true],
    ])
    expect(readFileSync(set)).not.toEqual(before)
    expect((await engine.undo(upgraded.run)).restored).toBe(1)
    expect(readFileSync(set)).toEqual(before)
  })

  test('a fix that fails says why, and a run that wrote something says which', async () => {
    const { engine, request } = computer()
    const failed = await engine
      .fix({ ...request, only: [tmp.path] })
      .catch((error: unknown) => error as RunFailed)
    expect(failed).toBeInstanceOf(RunFailed)
    expect((failed as RunFailed).message).toContain('not in a project folder that was checked')
    expect((failed as RunFailed).run).toBe('')
  })

  test('lists the folders of a folder, and says so when livesaver is gone', async () => {
    const { engine } = computer()
    const listing = await engine.folders(tmp.path)
    // `home` is livesaver's own folder, which is there once it runs.
    expect(listing.folders.map((folder) => folder.name)).toEqual(['home', 'projects', 'samples'])
    expect(engine.folders(join(tmp.path, 'gone'))).rejects.toBeInstanceOf(RunFailed)
    // A page of an earlier start has a token this livesaver does not know; one whose livesaver
    // was stopped gets no answer. Both are the engine being gone, not a run that failed.
    const lost = new ComputerEngine({ token: 'wrong', base: server.url })
    const stale = await lost.start().catch((error: unknown) => error)
    expect(stale).toBeInstanceOf(Unreachable)
    expect((stale as Error).message).toBe('This page is from an earlier start of livesaver.')
    await server.close()
    const gone = await engine.status().catch((error: unknown) => error)
    expect(gone).toBeInstanceOf(Unreachable)
    expect((gone as Error).message).toBe('livesaver on this computer does not answer.')
  })
})

describe('only the browser', () => {
  test('is handed folders: what they hold is seen at once, where they lie is found by the scan', async () => {
    const { engine } = browser()
    writeFile(join(tmp.path, 'Ableton', 'User Library', 'Samples', 'a.wav'), 'RIFF')
    writeFile(join(tmp.path, 'Shared', 'Drum Library', 'Samples', 'b.wav'), 'RIFF')
    const ableton = engine.add(uploadedFolder(join(tmp.path, 'Ableton')), 'search')
    const shared = engine.add(uploadedFolder(join(tmp.path, 'Shared')), 'search')
    expect([ableton.name, ableton.holds, ableton.vendor, ableton.path]).toEqual([
      'Ableton',
      ['User Library'],
      false,
      '',
    ])
    // A folder named like a vendor's is taken to hold installed libraries, in the search only.
    expect(shared.vendor).toBe(true)
    expect(engine.add(uploadedFolder(join(tmp.path, 'Shared')), 'projects').vendor).toBe(false)

    const project = engine.add(uploadedFolder(projects), 'projects')
    const progress: Progress[] = []
    const scan = await engine.scan(
      { projects: [project], search: [ableton, shared], options: OPTIONS },
      (event) => progress.push(event),
    )
    expect(scan.folders.map((folder) => [folder.id, folder.how])).toEqual([
      [project.id, 'found'],
      [ableton.id, 'unknown'],
      [shared.id, 'unknown'],
    ])
    expect(progress.find((event) => event.type === 'located')).toEqual({
      type: 'located',
      folders: scan.folders,
    })
    expect(scan.samples.ableton.userLibrary).toBe('/Ableton/User Library')
  })

  test('a folder it no longer has must be added again; a scan can be stopped', async () => {
    const { engine, request } = browser()
    const stopped = engine.scan(request)
    engine.stop()
    expect(stopped).rejects.toThrow('The scan was stopped.')
    await stopped.catch(() => {})
    engine.remove((request.projects[0] as ScanRequest['projects'][number]).id)
    expect(engine.scan(request)).rejects.toThrow('The folder "projects" has to be added again.')
    expect(existsSync(join(tmp.path, 'home', 'runs'))).toBe(false)
  })
})
