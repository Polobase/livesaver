/**
 * What is installed, from folders a page is handed: a plug-in folder and the folder of Live's
 * plug-in database, made up on disk as they lie on a Mac, and given as a browser gives them.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import type { PluginRef } from '@livesaver/core'
import { loadInstalledPlugins } from '@livesaver/node'
import {
  ARM64,
  copyFixtures,
  livePluginDatabase,
  pickedFolder,
  pluginBundle,
  type ScannedPlugin,
  tempDir,
  uploadedFolder,
  X86_64,
} from '@livesaver/test-kit'
import { withAppleUnits } from '../src/engine/installed.js'
import {
  type BrowserScan,
  type FolderInput,
  installedHoldsOf,
  installedIn,
  type ScanEvent,
  scanFolders,
} from '../src/index.js'

const SERUM_3 = 'device:vst3:instr:56535458-6673-5873-6572-756d00000000'
const MASSIVE_3 = 'device:vst3:instr:5653544e-694d-616d-6173-736976650000'
const SERUM_2 = 'device:vst:instr:1483109208?n=Serum'

let tmp: { path: string; cleanup: () => void }
/** A disk as a Mac has it, below the temporary folder. */
let system: string
let user: string
let database: string
beforeEach(() => {
  tmp = tempDir()
  system = join(tmp.path, 'Library', 'Audio', 'Plug-Ins')
  user = join(tmp.path, 'Users', 'someone', 'Library', 'Audio', 'Plug-Ins')
  database = join(tmp.path, 'Application Support', 'Ableton', 'Live Database')
})
afterEach(() => tmp.cleanup())

const folder = (id: string, source: FolderInput['source']): FolderInput => ({
  id,
  source,
  path: '',
  vendor: false,
})
const ref = (format: PluginRef['format'], ident: string, name: string): PluginRef => ({
  format,
  ident,
  name,
})
const SERUM_VST3 = ref('VST3', '56535458667358736572756d00000000', 'Serum')
const SERUM_VST2 = ref('VST2', '1483109208', 'Serum')
const MASSIVE_VST3 = ref('VST3', '5653544e694d616d6173736976650000', 'Massive')
const MASSIVE_VST2 = ref('VST2', '1315523937', 'Massive')

/**
 * Serum as a universal VST3 and an Intel-only VST2, Massive as VST3 only; Live scanned them at
 * the paths plug-ins have on a Mac (`at` = where the plug-in folder lies there).
 */
function install(at = '/Library/Audio/Plug-Ins', root = system): ScannedPlugin[] {
  pluginBundle(join(root, 'VST3', 'Serum.vst3'), [X86_64, ARM64])
  pluginBundle(join(root, 'VST', 'Serum.vst'), [X86_64])
  pluginBundle(join(root, 'VST3', 'Native Instruments', 'Massive.vst3'), [ARM64])
  return [
    { path: `${at}/VST3/Serum.vst3`, processor: 2, devIdentifier: SERUM_3, name: 'Serum' },
    { path: `${at}/VST3/Serum.vst3`, processor: 1, devIdentifier: SERUM_3, name: 'Serum' },
    { path: `${at}/VST/Serum.vst`, processor: 1, devIdentifier: SERUM_2, name: 'Serum' },
    // Live on Apple Silicon could not load the Intel-only VST2.
    {
      path: `${at}/VST/Serum.vst`,
      processor: 2,
      devIdentifier: SERUM_2,
      name: 'Serum',
      scanstate: 3,
    },
    {
      path: `${at}/VST3/Native Instruments/Massive.vst3`,
      processor: 2,
      devIdentifier: MASSIVE_3,
      name: 'Massive',
    },
  ]
}

const states = (installed: Awaited<ReturnType<typeof installedIn>>) =>
  [SERUM_VST3, SERUM_VST2, MASSIVE_VST3, MASSIVE_VST2].map(
    (plugin) => installed.inventory.status(plugin).state,
  )

describe('the plug-ins of folders a page was handed', () => {
  test('the plug-in folder and Live’s database: installed, Rosetta only, missing', async () => {
    livePluginDatabase(database, install())
    const installed = await installedIn([
      folder('plugins', uploadedFolder(system)),
      folder('database', uploadedFolder(database)),
    ])
    // The plug-in folder lies where the database's paths lead into it.
    expect([installed.roots, installed.database]).toEqual([['/Library/Audio/Plug-Ins'], true])
    expect(states(installed)).toEqual(['installed', 'rosetta', 'installed', 'missing'])
    expect(installed.inventory.status(SERUM_VST3).found.map((found) => found.path)).toEqual([
      '/Library/Audio/Plug-Ins/VST3/Serum.vst3',
      '/Library/Audio/Plug-Ins/VST3/Serum.vst3',
    ])
    // What an upgrade can convert to: the VST3 plug-ins Live knows.
    expect([...installed.catalog.values()].map((entry) => entry.name).sort()).toEqual([
      'Massive',
      'Serum',
    ])
  })

  test('on Windows Live’s database is all there is to read: its rows count as they are', async () => {
    // What Live scanned on Windows, at the paths plug-ins have there. No Rosetta: one row each.
    const scanned: ScannedPlugin[] = [
      {
        path: 'C:\\Program Files\\Common Files\\VST3\\Serum.vst3',
        processor: 1,
        devIdentifier: SERUM_3,
        name: 'Serum',
      },
      {
        path: 'C:\\Program Files\\VSTPlugins\\Serum_x64.dll',
        processor: 1,
        devIdentifier: SERUM_2,
        name: 'Serum',
      },
    ]
    const local = join(tmp.path, 'AppData', 'Local')
    livePluginDatabase(join(local, 'Ableton', 'Live Database'), scanned)
    // The folder of the database, or one above it (AppData/Local is where it is reached from).
    for (const given of [join(local, 'Ableton', 'Live Database'), local]) {
      const installed = await installedIn([folder('database', uploadedFolder(given))], true)
      expect([installed.roots, installed.database]).toEqual([[], true])
      // Installed without a look at a file, and none "Rosetta only": Windows has no such thing.
      expect(states(installed)).toEqual(['installed', 'installed', 'missing', 'missing'])
      expect(installed.inventory.status(SERUM_VST2).found.map((found) => found.path)).toEqual([
        'C:/Program Files/VSTPlugins/Serum_x64.dll',
      ])
      expect([...installed.catalog.values()].map((entry) => entry.name)).toEqual(['Serum'])
    }
    // The same folder on a Mac says nothing without the bundles: no row's file is there.
    const onMac = await installedIn([folder('database', uploadedFolder(local))])
    expect(states(onMac)).toEqual(['missing', 'missing', 'missing', 'missing'])
  })

  test('folders above them will do: the Library with its Audio folder, Application Support', async () => {
    livePluginDatabase(database, install())
    for (const source of [uploadedFolder, pickedFolder]) {
      const installed = await installedIn([
        folder('library', source(join(tmp.path, 'Library', 'Audio'))),
        folder('support', source(join(tmp.path, 'Application Support'))),
      ])
      expect([installed.roots, installed.database]).toEqual([['/Library/Audio/Plug-Ins'], true])
      expect(states(installed)).toEqual(['installed', 'rosetta', 'installed', 'missing'])
    }
  })

  test('what Live scanned last is still in the log beside its database while it runs', async () => {
    const live = livePluginDatabase(database, install(), true)
    try {
      const installed = await installedIn([
        folder('plugins', uploadedFolder(system)),
        folder('database', uploadedFolder(database)),
      ])
      expect(states(installed)).toEqual(['installed', 'rosetta', 'installed', 'missing'])
    } finally {
      live.close()
    }
  })

  test('the system’s plug-in folder and the user’s are each placed where they lie', async () => {
    const scanned = install()
    pluginBundle(join(user, 'VST3', 'Own.vst3'), [ARM64])
    const own = 'device:vst3:audiofx:00000000-0000-0000-0000-00000000abcd'
    livePluginDatabase(database, [
      ...scanned,
      {
        path: '/Users/someone/Library/Audio/Plug-Ins/VST3/Own.vst3',
        processor: 2,
        devIdentifier: own,
        name: 'Own',
      },
    ])
    const installed = await installedIn([
      folder('user', uploadedFolder(user)),
      folder('system', uploadedFolder(system)),
      folder('database', uploadedFolder(database)),
    ])
    expect(installed.roots).toEqual([
      '/Users/someone/Library/Audio/Plug-Ins',
      '/Library/Audio/Plug-Ins',
    ])
    expect(
      installed.inventory.status(ref('VST3', '0000000000000000000000000000abcd', 'Own')).state,
    ).toBe('installed')
    expect(states(installed)).toEqual(['installed', 'rosetta', 'installed', 'missing'])
  })

  test('without the database a VST2 plug-in cannot be recognised; a VST3 names itself', async () => {
    install()
    pluginBundle(
      join(system, 'VST3', 'Described.vst3'),
      [ARM64],
      {},
      {
        'Contents/Resources/moduleinfo.json': JSON.stringify({
          Name: 'Described',
          Classes: [
            {
              CID: 'ABCDEF0123456789ABCDEF0123456789',
              Category: 'Audio Module Class',
              Name: 'Described',
            },
          ],
        }),
      },
    )
    pluginBundle(join(system, 'Components', 'Delay.component'), [ARM64], {
      AudioComponents: [
        { type: 'aufx', subtype: 'dely', manufacturer: 'Vndr', name: 'Vendor: Delay' },
      ],
    })
    const installed = await installedIn([folder('plugins', uploadedFolder(system))])
    // No database places the folder: it lies at a path of its own.
    expect([installed.roots, installed.database]).toEqual([['/Plug-Ins'], false])
    expect(states(installed)).toEqual(['missing', 'missing', 'missing', 'missing'])
    expect(
      installed.inventory.status(ref('VST3', 'abcdef0123456789abcdef0123456789', 'Described'))
        .state,
    ).toBe('installed')
    expect(installed.inventory.status(ref('AU', 'aufx:dely:Vndr', 'Delay')).state).toBe('installed')
    expect(installed.catalog.size).toBe(0)
  })

  test('folders with nothing of the kind say nothing, and are no error', async () => {
    const { samples } = copyFixtures(tmp.path)
    const installed = await installedIn([folder('samples', uploadedFolder(samples))])
    expect([installed.roots, installed.database, installed.inventory.all]).toEqual([[], false, []])
    expect(await installedIn([])).toMatchObject({ roots: [], database: false })
  })

  test('the same as livesaver on the computer finds in the same folders', async () => {
    // Scanned at the paths the bundles really have here, as on the computer itself.
    livePluginDatabase(database, install(system))
    const here = await loadInstalledPlugins({
      database,
      pluginRoots: [system],
      systemComponents: '',
      auval: false,
    })
    const inPage = await installedIn([
      folder('plugins', uploadedFolder(system)),
      folder('database', uploadedFolder(database)),
    ])
    expect(inPage.roots).toEqual([system])
    const plain = (all: typeof here.all) => [...all].map((plugin) => JSON.stringify(plugin)).sort()
    expect(plain(inPage.inventory.all)).toEqual(plain(here.all))
    expect(inPage.inventory.failed).toEqual(here.failed)
    expect([...inPage.inventory.bundles.keys()].sort()).toEqual([...here.bundles.keys()].sort())
  })

  test('what a folder holds is said as soon as it is given', () => {
    livePluginDatabase(database, install())
    expect(installedHoldsOf(uploadedFolder(system))).toEqual(['Plug-ins'])
    expect(installedHoldsOf(uploadedFolder(join(tmp.path, 'Library', 'Audio')))).toEqual([
      'Plug-ins',
    ])
    expect(installedHoldsOf(uploadedFolder(database))).toEqual(["Live's plug-in database"])
    expect(installedHoldsOf(uploadedFolder(join(tmp.path, 'Application Support')))).toEqual([
      "Live's plug-in database",
    ])
    expect(installedHoldsOf(uploadedFolder(copyFixtures(tmp.path).samples))).toEqual([])
    // A handle is not read until it is used.
    expect(installedHoldsOf(pickedFolder(system))).toEqual([])
  })

  test('the Audio Units of Apple come with macOS: one that is used is taken to be there', async () => {
    const installed = await installedIn([])
    const delay = ref('AU', 'aufx:dely:appl', 'AUDelay')
    const other = ref('AU', 'aufx:dely:Vndr', 'Delay')
    const inventory = withAppleUnits(installed.inventory, [delay, delay, other, SERUM_VST3])
    expect(inventory.status(delay).state).toBe('installed')
    expect(inventory.status(other).state).toBe('missing')
    expect(inventory.all.map((plugin) => plugin.ident)).toEqual(['aufx:dely:appl'])
  })
})

describe('a scan with folders that say what is installed', () => {
  test('says for every plug-in of the sets whether it is there, and where it looked', async () => {
    const { projects } = copyFixtures(tmp.path)
    livePluginDatabase(database, install())
    const events: ScanEvent[] = []
    await scanFolders(
      {
        projects: [folder('p', uploadedFolder(projects))],
        search: [],
        installed: [
          folder('plugins', uploadedFolder(system)),
          folder('database', uploadedFolder(database)),
        ],
        options: { packLimitMB: 50, matchLibraryPath: false },
      },
      (event) => events.push(event),
      { cores: 4 },
    )
    const last = events.at(-1)
    if (last?.type !== 'scanned') throw new Error(JSON.stringify(last))
    const scan: BrowserScan = last.scan
    expect(scan.plugins.inventory).toBe(true)
    expect(scan.installed).toEqual({ roots: ['/Library/Audio/Plug-Ins'], database: true })
    // (The rows come with what needs attention first; here they are read by name.)
    expect(scan.plugins.uses.map((use) => [use.name, use.format, use.state]).sort()).toEqual([
      ['Massive', 'VST2', 'missing'],
      ['Massive', 'VST3', 'installed'],
      ['Omnisphere', 'VST2', 'missing'],
      ['Omnisphere', 'VST3', 'missing'],
      ['Serum', 'VST2', 'rosetta'],
      ['Serum', 'VST3', 'installed'],
    ])
    expect(scan.plugins.counts).toMatchObject({ used: 6, missing: 3, rosetta: 1 })
    // The plug-in folders are no place to look for samples in.
    const indexed = events.find((event) => event.type === 'indexed')
    expect(indexed).toEqual({ type: 'indexed', files: 1 })
    expect(
      events.filter((e) => e.type === 'phase').map((e) => e.type === 'phase' && e.phase),
    ).toEqual(['locating', 'indexing', 'checking', 'plugins', 'reporting'])
    expect(Object.keys(scan.seconds).sort()).toEqual([
      'checking',
      'indexing',
      'locating',
      'plugins',
      'reporting',
    ])
  })
})
