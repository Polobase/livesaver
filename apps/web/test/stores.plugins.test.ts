/**
 * The plug-in side of the app's state in a browser: the folders that say what is installed,
 * and an upgrade to VST3 that the page makes itself, in a project folder it may edit.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  copyFixtures,
  MemoryDirectory,
  memoryFiles,
  memoryFolder,
  tempDir,
  uploadedFolder,
} from '@livesaver/test-kit'
import { folderFromHandle, localEngineWorker } from '@livesaver/web'
import { createPinia, setActivePinia } from 'pinia'
import { BrowserEngine } from '../src/engine/index.js'
import { PLUGIN_DATABASE, PLUGIN_FOLDER } from '../src/lib/library.js'
import { useEngineStore } from '../src/stores/engine.js'
import { useHistoryStore } from '../src/stores/history.js'
import { useLibraryStore } from '../src/stores/library.js'
import { usePluginsStore } from '../src/stores/plugins.js'
import { useScanStore } from '../src/stores/scan.js'
import { installPlugins, VST_SET } from './engine-setup.js'

let tmp: { path: string; cleanup: () => void }
let projects: string
/** A plug-in folder and the folder of Live's database, as a Mac has them. */
let mac: { plugins: string; database: string }

beforeEach(() => {
  tmp = tempDir()
  ;({ projects } = copyFixtures(tmp.path))
  mac = installPlugins(tmp.path)
})
afterEach(() => tmp.cleanup())

/** How the plug-ins of the sets stand, by name and format. */
const states = (scans: ReturnType<typeof useScanStore>) =>
  (scans.scan?.plugins.uses ?? [])
    .map((use) => `${use.name} ${use.format}: ${use.state}`)
    .sort((a, b) => a.localeCompare(b))

describe('folders that say what is installed', () => {
  test('are part of a scan: with them the page knows which plug-ins are there', async () => {
    setActivePinia(createPinia())
    const engines = useEngineStore()
    engines.use(new BrowserEngine({ spawn: () => localEngineWorker({ cores: 4 }) }))
    await engines.load()
    const library = useLibraryStore()
    const scans = useScanStore()
    library.addSources('projects', [uploadedFolder(projects)])

    // Without them a page cannot say whether a plug-in is installed.
    expect(library.request.installed).toBeUndefined()
    expect(await scans.run()).toBe(true)
    expect([scans.scan?.plugins.inventory, scans.scan?.installed]).toEqual([false, undefined])
    expect(new Set(scans.scan?.plugins.uses.map((use) => use.state))).toEqual(new Set(['unknown']))

    // The plug-in folder alone: a plug-in is known only if its bundle says which one it is.
    library.addSources('installed', [uploadedFolder(mac.plugins)])
    expect([...library.installedHolds]).toEqual([PLUGIN_FOLDER])
    expect(library.request.installed?.map((folder) => folder.name)).toEqual(['Plug-Ins'])
    expect(scans.stale).toBe(true)
    expect(await scans.run()).toBe(true)
    expect(scans.scan?.installed).toEqual({ roots: ['/Plug-Ins'], database: false })
    expect(scans.scan?.plugins.inventory).toBe(true)
    expect(states(scans)).toEqual([
      'Massive VST2: missing',
      'Massive VST3: installed',
      'Omnisphere VST2: missing',
      'Omnisphere VST3: missing',
      'Serum VST2: missing',
      'Serum VST3: missing',
    ])

    // With Live's database the folder is placed where the database's paths lead into it, and
    // the plug-ins stand as livesaver on the computer says them.
    library.addSources('installed', [uploadedFolder(mac.database)])
    expect([...library.installedHolds].sort()).toEqual([PLUGIN_DATABASE, PLUGIN_FOLDER].sort())
    expect(scans.stale).toBe(true)
    expect(await scans.run()).toBe(true)
    expect(scans.scan?.installed).toEqual({ roots: ['/Library/Audio/Plug-Ins'], database: true })
    expect(states(scans)).toEqual([
      'Massive VST2: missing',
      'Massive VST3: installed',
      'Omnisphere VST2: missing',
      'Omnisphere VST3: missing',
      'Serum VST2: rosetta',
      'Serum VST3: installed',
    ])

    // Taken away again, the scan is no longer what the folders say.
    for (const folder of [...library.installed]) library.remove('installed', folder.id)
    expect([library.installed.length, library.request.installed, scans.stale]).toEqual([
      0,
      undefined,
      true,
    ])
  })
})

describe('an upgrade in a browser that lets a page edit folders', () => {
  test('is planned with the folders of the scan, written into the folder, and taken back', async () => {
    setActivePinia(createPinia())
    const folder = memoryFolder(projects)
    const state = new MemoryDirectory('')
    const storage = async () => state
    const engines = useEngineStore()
    engines.use(
      new BrowserEngine({
        spawn: () => localEngineWorker({ cores: 4, state: storage }),
        state: storage,
        writing: () => true,
      }),
    )
    await engines.load()
    const library = useLibraryStore()
    const scans = useScanStore()
    const plugins = usePluginsStore()
    const history = useHistoryStore()
    expect(engines.capabilities.upgrade).toBe(true)

    library.addSources('projects', [folderFromHandle(folder)])
    library.addSources('installed', [uploadedFolder(mac.plugins), uploadedFolder(mac.database)])
    expect(await library.access(library.projects[0]?.id as string)).toBe('edit')
    expect(await scans.run()).toBe(true)

    // The plan needs what Live knows: it is asked with the folders the scan was told by.
    expect(await plugins.loadPlan()).toBe(true)
    expect(plugins.convertible.map((plugin) => plugin.plugin)).toEqual(['Massive', 'Serum'])
    const set = () => memoryFiles(folder).get(VST_SET)
    const before = set()?.data
    expect(set()?.writes).toBe(0)

    plugins.open(['Serum'])
    expect(plugins.chosen.map((plugin) => plugin.plugin)).toEqual(['Serum'])
    expect(await plugins.apply()).toBe(true)
    expect(plugins.upgraded).toMatchObject({ sets: 1, errors: [] })
    expect(set()?.writes).toBe(1)
    expect(set()?.data).not.toEqual(before)
    // Scanned and planned again: only Massive is left to upgrade.
    expect(plugins.convertible.map((plugin) => plugin.plugin)).toEqual(['Massive'])
    expect(history.runs.map((run) => [run.command, run.state, run.sets])).toEqual([
      ['vst3', 'applied', 1],
    ])
    expect(plugins.last?.id).toBe(plugins.upgraded?.run as string)

    expect(await plugins.undo(plugins.upgraded?.run as string)).toBe(true)
    expect(plugins.undone).toMatchObject({ restored: 1, problems: [] })
    expect(set()?.data).toEqual(before)
    expect(plugins.convertible.map((plugin) => plugin.plugin)).toEqual(['Massive', 'Serum'])
    expect(history.runs[0]).toMatchObject({ state: 'undone', canUndo: false })
  })

  test('without Live’s database among the folders, the plan says that it has nothing to go by', async () => {
    setActivePinia(createPinia())
    const state = new MemoryDirectory('')
    const storage = async () => state
    const engines = useEngineStore()
    engines.use(
      new BrowserEngine({
        spawn: () => localEngineWorker({ cores: 4, state: storage }),
        state: storage,
        writing: () => true,
      }),
    )
    await engines.load()
    const library = useLibraryStore()
    const scans = useScanStore()
    const plugins = usePluginsStore()
    library.addSources('projects', [folderFromHandle(memoryFolder(projects))])
    expect(await scans.run()).toBe(true)
    expect(await plugins.loadPlan()).toBe(false)
    expect(plugins.problem).toContain('this page needs Live’s plug-in database')
    expect(plugins.plan).toBeUndefined()

    // Scanned again with the folders, what stood in the way is no longer said, and the plan
    // can be made.
    library.addSources('installed', [uploadedFolder(mac.plugins), uploadedFolder(mac.database)])
    expect(await scans.run()).toBe(true)
    expect(plugins.problem).toBe('')
    expect(await plugins.loadPlan()).toBe(true)
    expect(plugins.convertible.map((plugin) => plugin.plugin)).toEqual(['Massive', 'Serum'])
  })
})
