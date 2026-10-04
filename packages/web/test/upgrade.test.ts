/**
 * An upgrade of VST2 plug-ins to VST3 in the browser: planned from the folders a page was
 * handed, and applied through handles, it does what the command line's pipeline does.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createNodeHost } from '@livesaver/node'
import { applyWriter, Probe, upgradePlugins, upgradeView } from '@livesaver/ops'
import {
  ARM64,
  copyFixtures,
  livePluginDatabase,
  MemoryDirectory,
  type MemoryFile,
  memoryFiles,
  memoryFolder,
  pluginBundle,
  readSet,
  tempDir,
  uploadedFolder,
} from '@livesaver/test-kit'
import {
  browserReport,
  browserRuns,
  EngineFailure,
  type FolderInput,
  folderFromHandle,
  installedIn,
  localEngineWorker,
  planUpgradeFolders,
  planUpgradeInWorker,
  type UpgradeEvent,
  type UpgradeRequest,
  undoFolders,
  upgradeFolders,
  upgradeInWorker,
} from '../src/index.js'

const SERUM_3 = 'device:vst3:instr:56535458-6673-5873-6572-756d00000000'
const MASSIVE_3 = 'device:vst3:instr:5653544e-694d-616d-6173-736976650000'
const SET = 'VST2toVST3 Project/VST2toVST3.als'

let tmp: { path: string; cleanup: () => void }
let projects: string
let plugins: string
let database: string
let folder: MemoryDirectory
let state: MemoryDirectory
beforeEach(() => {
  tmp = tempDir()
  ;({ projects } = copyFixtures(tmp.path))
  plugins = join(tmp.path, 'Library', 'Audio', 'Plug-Ins')
  database = join(tmp.path, 'Live Database')
  // Live knows the VST3 of Serum and of Massive: what the sets' VST2 devices can become.
  const at = '/Library/Audio/Plug-Ins/VST3'
  pluginBundle(join(plugins, 'VST3', 'Serum.vst3'), [ARM64])
  pluginBundle(join(plugins, 'VST3', 'Massive.vst3'), [ARM64])
  livePluginDatabase(database, [
    { path: `${at}/Serum.vst3`, processor: 2, devIdentifier: SERUM_3, name: 'Serum' },
    { path: `${at}/Massive.vst3`, processor: 2, devIdentifier: MASSIVE_3, name: 'Massive' },
  ])
  folder = memoryFolder(projects)
  state = new MemoryDirectory('')
})
afterEach(() => tmp.cleanup())

const given = (id: string, source: FolderInput['source'], path = ''): FolderInput => ({
  id,
  source,
  path,
  vendor: false,
})
const installed = () => [
  given('plugins', uploadedFolder(plugins)),
  given('database', uploadedFolder(database)),
]
const request = (more: Partial<UpgradeRequest> = {}): UpgradeRequest => ({
  projects: [given('p', folderFromHandle(folder), projects)],
  search: [],
  installed: installed(),
  options: { packLimitMB: 50, matchLibraryPath: false },
  ...more,
})
const options = () => ({ cores: 1, state: async () => state })

async function plan(asked = request()) {
  const events: UpgradeEvent[] = []
  await planUpgradeFolders(asked, (event) => events.push(event), { cores: 1 })
  const last = events.at(-1) as UpgradeEvent
  return {
    events,
    planned: last.type === 'planned' ? last.upgrade : undefined,
    failed: last.type === 'failed' ? last.message : '',
  }
}

async function upgrade(asked = request()) {
  const events: UpgradeEvent[] = []
  await upgradeFolders(asked, (event) => events.push(event), options())
  const last = events.at(-1) as UpgradeEvent
  return {
    events,
    upgraded: last.type === 'upgraded' ? last.upgraded : undefined,
    failed: last.type === 'failed' ? last : undefined,
  }
}

/** The pipeline of `livesaver plugins upgrade` on the folders on disk. */
async function commandLine(apply: boolean, only: string[] = []) {
  const { catalog } = await installedIn(installed())
  const host = createNodeHost({ write: apply, finder: false })
  const probe = new Probe(host.fs, host.hash)
  return upgradePlugins(host, {
    targets: [projects],
    catalog,
    only,
    probe,
    ...(apply
      ? { writer: applyWriter(host, { id: 'run', dir: join(tmp.path, 'run') }, probe) }
      : {}),
  })
}

const xmlOf = (file: MemoryFile | undefined) =>
  new TextDecoder().decode(gunzipSync(file?.data ?? new Uint8Array(0)))
/** A view without how long it took. */
const timeless = <T extends object>(view: T) => ({ ...view, seconds: 0, ms: 0 })

describe('an upgrade in the browser', () => {
  test('is planned as the command line plans it', async () => {
    const { planned, events } = await plan()
    const expected = upgradeView(await commandLine(false))
    expect(timeless(planned as object)).toEqual(timeless(expected))
    expect([planned?.sets, planned?.changingSets]).toEqual([3, 1])
    expect(planned?.plugins.map((p) => [p.plugin, p.convertibleInstances])).toEqual([
      ['Massive', 1],
      ['Omnisphere', 0],
      ['Serum', 1],
    ])
    expect(events[0]).toEqual({ type: 'phase', phase: 'plugins' })
    expect(events.filter((event) => event.type === 'progress').length).toBe(3)
    // Nothing was written, and no run was made of it.
    expect([...memoryFiles(folder).values()].every((file) => file.writes === 0)).toBe(true)
    expect(await browserRuns(async () => state)).toEqual([])
  })

  test('writes the set the command line writes, byte for byte once unpacked', async () => {
    const original = readFileSync(join(projects, SET))
    const { upgraded, events } = await upgrade(request({ names: ['Serum'] }))
    await commandLine(true, ['Serum'])
    expect(upgraded?.sets).toBe(1)
    expect(upgraded?.errors).toEqual([])
    expect(upgraded?.upgrade.rows.map((row) => [row.plugin, row.converted, row.written])).toEqual([
      ['Serum', true, true],
    ])
    expect(
      events.filter((e) => e.type === 'phase').map((e) => e.type === 'phase' && e.phase),
    ).toEqual(['plugins', 'upgrading'])
    const files = memoryFiles(folder)
    expect(xmlOf(files.get(SET))).toBe(readSet(join(projects, SET)))
    expect(files.get(SET)?.writes).toBe(1)
    // The project has a backup Live made itself; the one of the upgrade is the set as it was.
    const backups = [...files].filter(
      ([path, file]) =>
        /^VST2toVST3 Project\/Backup\/VST2toVST3 \[\d{4}-\d\d-\d\d \d{6}\]\.als$/.test(path) &&
        file.writes > 0,
    )
    expect(backups.length).toBe(1)
    expect(Buffer.from(backups[0]?.[1].data ?? []).equals(original)).toBe(true)

    // The run is kept like a fix: named, with its report, and it can be undone.
    const [run] = await browserRuns(async () => state)
    expect(run).toMatchObject({ id: upgraded?.run, command: 'vst3', state: 'applied', sets: 1 })
    expect(run?.record?.options).toEqual({ plugin: ['Serum'], exclude: [] })
    expect(run?.record?.outcome).toMatchObject({ sets: 3, changingSets: 1, written: 1, errors: 0 })
    expect(run?.reports).toEqual(['vst3_upgrade.csv'])
    expect(await browserReport(async () => state, run?.id as string, 'vst3_upgrade.csv')).toContain(
      'Serum',
    )

    const undone: unknown[] = []
    await undoFolders(
      { ...request(), run: upgraded?.run as string },
      (e) => undone.push(e),
      options(),
    )
    expect(undone.at(-1)).toMatchObject({ type: 'undone', undone: { restored: 1, problems: [] } })
    expect(Buffer.from(memoryFiles(folder).get(SET)?.data ?? []).equals(original)).toBe(true)
  })

  test('needs Live’s plug-in database, and a folder it may edit', async () => {
    const without = request({ installed: [given('plugins', uploadedFolder(plugins))] })
    const wanted =
      'To know which VST3 plug-ins Live has, this page needs Live’s plug-in database: add the folder “Live Database” to the plug-in folders, and scan again.'
    expect((await plan(without)).failed).toBe(wanted)
    expect((await upgrade(without)).failed).toEqual({ type: 'failed', message: wanted })
    expect((await plan(request({ installed: [] }))).failed).toBe(wanted)

    // A database that knows no VST3 plug-in at all.
    const empty = join(tmp.path, 'Empty', 'Live Database')
    livePluginDatabase(empty, [])
    expect(
      (await plan(request({ installed: [given('database', uploadedFolder(empty))] }))).failed,
    ).toBe("No VST3 plug-ins in Live's plug-in database.")

    const readOnly = request({ projects: [given('p', uploadedFolder(projects), projects)] })
    // A plan only reads: an uploaded folder will do for it.
    expect((await plan(readOnly)).planned?.changingSets).toBe(1)
    expect((await upgrade(readOnly)).failed?.message).toStartWith(
      'The project folder “projects” was not given for editing',
    )
    expect(await browserRuns(async () => state)).toEqual([])
  })

  test('goes through the engine’s worker, as a page asks for it', async () => {
    const spawn = () => localEngineWorker(options())
    const planned = await planUpgradeInWorker(spawn, request(), () => {})
    expect(planned.changingSets).toBe(1)
    const events: UpgradeEvent[] = []
    const upgraded = await upgradeInWorker(spawn, request({ names: ['Massive'] }), (event) =>
      events.push(event),
    )
    expect(upgraded.sets).toBe(1)
    expect(events.some((event) => event.type === 'progress')).toBe(true)
    // What is left to plan after it: Serum.
    const left = await planUpgradeInWorker(spawn, request(), () => {})
    expect(left.plugins.filter((p) => p.convertibleInstances > 0).map((p) => p.plugin)).toEqual([
      'Serum',
    ])
    // A plan needs no storage; an upgrade does.
    const reading = () => localEngineWorker({ cores: 1 })
    expect((await planUpgradeInWorker(reading, request(), () => {})).changingSets).toBe(1)
    const refused = upgradeInWorker(reading, request(), () => {})
    expect(refused).rejects.toBeInstanceOf(EngineFailure)
    expect(refused).rejects.toThrow('This page has no storage of its own to keep an undo in.')
  })
})
