/**
 * The app's state without a page: the library, a scan, a fix and its undo, against livesaver on
 * a temporary copy of the fixtures, and against the browser's engine.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cpSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Inventory } from '@livesaver/plugins'
import { copyFixtures, readSet, tempDir, uploadedFolder, writeFile } from '@livesaver/test-kit'
import { localEngineWorker } from '@livesaver/web'
import { startWeb, type WebServer } from 'livesaver'
import { createPinia, setActivePinia } from 'pinia'
import { BrowserEngine, ComputerEngine } from '../src/engine/index.js'
import { useEngineStore } from '../src/stores/engine.js'
import { useFixStore } from '../src/stores/fix.js'
import { useHistoryStore } from '../src/stores/history.js'
import { useLibraryStore } from '../src/stores/library.js'
import { useScanStore } from '../src/stores/scan.js'

let tmp: { path: string; cleanup: () => void }
let projects: string
let samples: string
let server: WebServer
const saved = { home: process.env.LIVESAVER_HOME, trash: process.env.LIVESAVER_TRASH_DIR }

beforeEach(async () => {
  tmp = tempDir()
  ;({ projects, samples } = copyFixtures(tmp.path))
  // A second project with the same broken set: one is fixed alone, then the rest.
  cpSync(join(projects, 'Brokenpath Project'), join(projects, 'Other Project'), { recursive: true })
  process.env.LIVESAVER_HOME = join(tmp.path, 'home')
  process.env.LIVESAVER_TRASH_DIR = join(tmp.path, 'trash')
  const config = join(tmp.path, 'config.json')
  writeFileSync(
    config,
    JSON.stringify({ appResources: '', vendorLibraries: [], searchRoots: [samples] }),
  )
  server = await startWeb({
    assets: false,
    config,
    force: true,
    plugins: async () => ({ inventory: new Inventory([]), catalog: new Map() }),
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

/** The stores of a page that was just opened, with livesaver behind it. */
async function onComputer() {
  setActivePinia(createPinia())
  const engines = useEngineStore()
  engines.use(new ComputerEngine({ token: server.token, base: server.url }))
  await engines.load()
  const library = useLibraryStore()
  const scans = useScanStore()
  const fix = useFixStore()
  const history = useHistoryStore()
  if (engines.start) {
    library.init(engines.start)
    scans.restore(engines.start.last)
  }
  await history.refresh()
  return { engines, library, scans, fix, history }
}

const setOf = (project: string) => join(projects, project, 'Brokenpath.als')
const fixedOnDisk = (project: string) => readSet(setOf(project)).includes('Samples/Imported')

describe('with livesaver on this computer', () => {
  test('the library starts with the computer’s sample folders, and wants a project folder', async () => {
    const { engines, library, scans } = await onComputer()
    expect(engines.kind).toBe('computer')
    expect(engines.capabilities).toMatchObject({ fix: true, paths: true, history: true })
    expect(library.search.map((folder) => [folder.name, folder.path, folder.vendor])).toEqual([
      ['samples', samples, false],
    ])
    expect([library.canScan, scans.scan]).toEqual([false, undefined])
    expect(library.wanted).toEqual({ libraries: true, live: true })

    library.addPath('projects', await engines.engine().folders(projects))
    library.addPath('projects', await engines.engine().folders(projects)) // twice is once
    expect(library.projects.map((folder) => folder.path)).toEqual([projects])
    expect(library.canScan).toBe(true)
    // A folder called like a vendor's is marked as holding installed libraries, in the search.
    writeFile(join(tmp.path, 'Shared', 'x.wav'), 'RIFF')
    library.addPath('search', await engines.engine().folders(join(tmp.path, 'Shared')))
    expect(library.search.at(-1)).toMatchObject({ name: 'Shared', vendor: true })
    expect(library.libraryMarked).toBe(true)
    library.remove('search', join(tmp.path, 'Shared'))
    expect(library.libraryMarked).toBe(false)
  })

  test('a scan shows how far it is, then what it found; changing a folder makes it stale', async () => {
    const { engines, library, scans } = await onComputer()
    library.addPath('projects', await engines.engine().folders(projects))
    const seen: string[] = []
    const stop = scans.$subscribe(() => {
      if (scans.running)
        seen.push(`${scans.progress.phase} ${scans.progress.done}/${scans.progress.total}`)
    })
    expect(await scans.run()).toBe(true)
    stop()
    expect(seen).toContain('checking 4/4')
    expect([scans.running, scans.problem, scans.stale]).toEqual([false, '', false])
    expect(scans.scan?.samples.projectRows.map((row) => [row.path, row.changingSets])).toEqual([
      ['Brokenpath Project', 1],
      ['Fixed Path Project', 0],
      ['Other Project', 1],
      ['VST2toVST3 Project', 0],
    ])

    library.options = { ...library.options, matchLibraryPath: true }
    expect(scans.stale).toBe(true)
    library.options = { ...library.options, matchLibraryPath: false }
    expect(scans.stale).toBe(false)
    library.update(samples, { vendor: true })
    expect(scans.stale).toBe(true)
  })

  test('a scan that fails says why, and keeps what was found before', async () => {
    const { engines, library, scans } = await onComputer()
    library.addPath('projects', await engines.engine().folders(projects))
    await scans.run()
    const before = scans.scan
    library.projects = [
      { ...library.projects[0], id: '/gone', path: '/gone', name: 'gone' } as never,
    ]
    expect(await scans.run()).toBe(false)
    expect(scans.problem).toBe('This folder does not exist: /gone')
    expect(scans.scan).toBe(before)
  })

  test('one project is fixed after a review, the scan is renewed, and undo takes it back', async () => {
    const { engines, library, scans, fix } = await onComputer()
    library.addPath('projects', await engines.engine().folders(projects))
    await scans.run()
    const other = scans.scan?.samples.projectRows.find((row) => row.path === 'Other Project')

    fix.open([other?.root as string])
    expect(fix.plan).toMatchObject({ sets: 1, changes: 1, copyFiles: 1, copyBytes: 2000324 })
    expect(fix.plan?.projects.map((row) => row.path)).toEqual(['Other Project'])
    // Asked when the review opens: is Live closed, is there room where the projects lie?
    await fix.refreshStatus()
    expect(fix.status?.liveRunning).toBe(false)
    expect(fix.status?.freeBytes).toBeGreaterThan(1_000_000)

    // The page was changed since: the fix still does what was scanned.
    library.options = { ...library.options, packLimitMB: 1 }
    expect(await fix.apply()).toBe(true)
    expect(fix.fixed).toMatchObject({ sets: 1, files: 1, errors: [] })
    expect([fixedOnDisk('Other Project'), fixedOnDisk('Brokenpath Project')]).toEqual([true, false])
    expect(fix.last?.id).toBe(fix.fixed?.run)
    // The scan was renewed: one project is left to fix.
    expect(scans.scan?.samples.changingSets).toBe(1)

    const run = fix.fixed?.run as string
    expect(await fix.undo(run)).toBe(true)
    expect(fix.undone).toMatchObject({ restored: 1, trashed: 2, problems: [] })
    expect([fix.fixed, fix.last]).toEqual([undefined, undefined])
    expect(fixedOnDisk('Other Project')).toBe(false)
    expect(scans.scan?.samples.changingSets).toBe(2)
  })

  test('all projects are fixed; a page that is opened again knows the scan and the last fix', async () => {
    const { engines, library, scans, fix } = await onComputer()
    library.addPath('projects', await engines.engine().folders(projects))
    await scans.run()
    fix.open()
    fix.review = { ...fix.review, certainOnly: true }
    expect(fix.plan).toMatchObject({ sets: 2, uncertain: 0 })
    await fix.apply()
    fix.close()
    expect([fixedOnDisk('Other Project'), fixedOnDisk('Brokenpath Project')]).toEqual([true, true])
    expect(scans.scan?.samples.changingSets).toBe(0)

    const again = await onComputer()
    expect(again.library.projects.map((folder) => folder.path)).toEqual([projects])
    expect(again.scans.scan?.samples.completeSets).toBe(4)
    expect(again.scans.stale).toBe(false)
    expect(again.fix.last).toMatchObject({ sets: 2, files: 2, state: 'applied' })
    expect(again.fix.last?.record?.options).toMatchObject({ certainOnly: true })
  })

  test('the history lists every run; one taken back there is no longer a fix to undo', async () => {
    const { engines, library, scans, fix, history } = await onComputer()
    expect([history.loaded, history.runs]).toEqual([true, []])
    library.addPath('projects', await engines.engine().folders(projects))
    await scans.run()
    // A scan plans and writes nothing: it is no run.
    await history.refresh()
    expect(history.runs).toEqual([])

    const other = scans.scan?.samples.projectRows.find((row) => row.path === 'Other Project')
    fix.open([other?.root as string])
    await fix.apply()
    fix.close()
    fix.open()
    await fix.apply()
    fix.close()
    expect(history.runs.map((run) => [run.command, run.state, run.sets, run.canUndo])).toEqual([
      ['collect', 'applied', 1, true],
      ['collect', 'applied', 1, true],
    ])
    const [newest, first] = history.runs.map((run) => run.id) as [string, string]
    expect([fix.last?.id, fix.fixed?.run]).toEqual([newest, newest])
    expect(history.runs[1]?.record?.targets).toEqual([join(projects, 'Other Project')])

    const detail = await history.detail(newest)
    expect(detail.steps.map((step) => [step.op, step.finished, step.undone])).toEqual([
      ['copy', true, ''],
      ['write-set', true, ''],
    ])
    expect(detail.steps[1]?.backup).toContain('Brokenpath Project/Backup/Brokenpath [')
    expect(await history.report(newest, 'changes.csv')).toContain('Brokenpath.als')

    // Taken back in the history: the overview no longer offers to undo it, the scan is renewed.
    expect(await history.takeBack(newest)).toBe(true)
    expect(history.undone).toMatchObject({ run: newest, result: { restored: 1, problems: [] } })
    expect([history.undoing, history.busy, history.problem]).toEqual(['', false, ''])
    expect(history.runs.map((run) => [run.state, run.canUndo])).toEqual([
      ['undone', false],
      ['applied', true],
    ])
    expect([fix.fixed, fix.last?.id]).toEqual([undefined, first])
    expect([fixedOnDisk('Brokenpath Project'), fixedOnDisk('Other Project')]).toEqual([false, true])
    expect(scans.scan?.samples.changingSets).toBe(1)
    expect((await history.detail(newest)).steps.map((step) => step.undone)).toEqual([
      'trashed',
      'restored',
    ])

    // Nothing is left of it to take back: a second undo does nothing, and a run that is not
    // there says so.
    expect(await history.takeBack(newest)).toBe(true)
    expect(history.undone?.result).toMatchObject({ restored: 0, trashed: 0, problems: [] })
    expect(await history.takeBack('nothing')).toBe(false)
    expect([history.undone, history.problem]).toEqual([
      undefined,
      'The undo failed: This is not a run that changed anything: nothing',
    ])
    expect(fixedOnDisk('Other Project')).toBe(true)
  })

  test('a fix that cannot run says why and changes nothing', async () => {
    const { engines, library, scans, fix } = await onComputer()
    library.addPath('projects', await engines.engine().folders(projects))
    await scans.run()
    const before = scans.scan
    fix.open([tmp.path])
    expect(await fix.apply()).toBe(false)
    expect(fix.failure?.message).toContain('not in a project folder that was checked')
    expect([fix.failure?.run, fix.fixed, scans.scan === before]).toEqual(['', undefined, true])
    // The review stays open while a fix runs, and closes when asked.
    fix.close()
    expect(fix.review).toBeUndefined()
  })
})

describe('in the browser', () => {
  test('folders are handed over, the scan places them, and nothing can be fixed', async () => {
    setActivePinia(createPinia())
    const engines = useEngineStore()
    engines.use(new BrowserEngine({ spawn: () => localEngineWorker({ cores: 4 }) }))
    await engines.load()
    const library = useLibraryStore()
    const scans = useScanStore()
    const fix = useFixStore()
    if (engines.start) library.init(engines.start)
    expect([engines.kind, engines.capabilities.fix, library.canScan]).toEqual([
      'browser',
      false,
      false,
    ])

    library.addSources('projects', [uploadedFolder(projects)])
    library.addSources('search', [uploadedFolder(samples)])
    expect(library.projects.map((folder) => [folder.name, folder.path])).toEqual([['projects', '']])
    expect(await scans.run()).toBe(true)
    expect(scans.progress.phase).toBe('reporting')
    const [project, search] = [library.projects[0], library.search[0]]
    expect(library.located.get(project?.id as string)).toMatchObject({ how: 'found' })
    expect(library.located.get(search?.id as string)).toMatchObject({ how: 'unknown' })
    expect(scans.scan?.samples.changingSets).toBe(2)

    // A typed path is part of what is scanned.
    library.update(search?.id as string, { path: '/Volumes/Samples' })
    expect(scans.stale).toBe(true)

    // A page on its own keeps no runs: there is nothing to list, and nothing to take back.
    const history = useHistoryStore()
    await history.refresh()
    expect([history.loaded, history.runs, fix.last]).toEqual([false, [], undefined])
    expect(await history.takeBack('2026-10-03_120000_collect_apply')).toBe(false)
    expect(history.problem).toBe('The undo failed: Undo is not possible here.')
    fix.open()
    expect(await fix.apply()).toBe(false)
    expect(fix.failure?.message).toBe('Fixing is not possible here.')

    library.remove('search', search?.id as string)
    library.remove('projects', project?.id as string)
    expect(library.canScan).toBe(false)
  })
})
