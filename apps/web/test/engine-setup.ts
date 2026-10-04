/**
 * What the tests of the engines share: livesaver on a temporary copy of the fixtures, and the
 * engines over it as an app would have them.
 */
import { afterEach, beforeEach } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Catalog, type CatalogEntry, Inventory } from '@livesaver/plugins'
import {
  ARM64,
  copyFixtures,
  livePluginDatabase,
  MemoryDirectory,
  memoryFolder,
  pluginBundle,
  tempDir,
  uploadedFolder,
  X86_64,
} from '@livesaver/test-kit'
import { folderFromHandle, localEngineWorker } from '@livesaver/web'
import { startWeb, type WebServer } from 'livesaver'
import {
  BrowserEngine,
  ComputerEngine,
  type Engine,
  folderAt,
  type Scan,
  type ScanRequest,
} from '../src/engine/index.js'

const MASSIVE_VST3 = '5653544e694d616d6173736976650000'
const SERUM_VST3 = '56535458667358736572756d00000000'
const CATALOG: Catalog = new Map<string, CatalogEntry>([
  [MASSIVE_VST3, { devIdentifier: `device:vst3:instr:${MASSIVE_VST3}`, name: 'Massive' }],
  [SERUM_VST3, { devIdentifier: `device:vst3:instr:${SERUM_VST3}`, name: 'Serum' }],
])

export const OPTIONS = { packLimitMB: 50, matchLibraryPath: false }
export const SET = 'Brokenpath Project/Brokenpath.als'
export const VST_SET = 'VST2toVST3 Project/VST2toVST3.als'

/**
 * Plug-ins on a disk as a Mac has it, below `root`, as the page of a browser is shown them: a
 * plug-in folder with the VST3 of Serum and Massive and an Intel-only VST2 of Serum, and
 * Live's database of them. The VST3 of Massive says which plug-in it is (a newer one, with its
 * `moduleinfo.json`); the others are known through Live's database only. Returns the two
 * folders to hand to a page.
 */
export function installPlugins(root: string): { plugins: string; database: string } {
  const plugins = join(root, 'Library', 'Audio', 'Plug-Ins')
  const database = join(root, 'Live Database')
  const at = '/Library/Audio/Plug-Ins'
  pluginBundle(join(plugins, 'VST3', 'Serum.vst3'), [X86_64, ARM64])
  pluginBundle(
    join(plugins, 'VST3', 'Massive.vst3'),
    [ARM64],
    {},
    {
      'Contents/Resources/moduleinfo.json': `{"Classes": [{"CID": "${MASSIVE_VST3.toUpperCase()}", "Name": "Massive"}]}`,
    },
  )
  pluginBundle(join(plugins, 'VST', 'Serum.vst'), [X86_64])
  const serum = `device:vst3:instr:${SERUM_VST3.replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-')}`
  const massive = `device:vst3:instr:${MASSIVE_VST3.replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-')}`
  livePluginDatabase(database, [
    { path: `${at}/VST3/Serum.vst3`, processor: 2, devIdentifier: serum, name: 'Serum' },
    { path: `${at}/VST3/Massive.vst3`, processor: 2, devIdentifier: massive, name: 'Massive' },
    {
      path: `${at}/VST/Serum.vst`,
      processor: 1,
      devIdentifier: 'device:vst:instr:1483109208?n=Serum',
      name: 'Serum',
    },
  ])
  return { plugins, database }
}

export interface Setup {
  readonly engine: Engine
  readonly request: ScanRequest
}

/** The library of a test, made anew for each: where it lies, and the livesaver that serves it. */
export interface Fixtures {
  tmp: { path: string; cleanup: () => void }
  projects: string
  samples: string
  server: WebServer
  /** What livesaver was asked to show in the file manager. */
  revealed: string[]
}

/** Call at the top of a test file: its tests get a library each, and the engines over it. */
export function useLibrary() {
  const now = {} as Fixtures
  const saved = { home: process.env.LIVESAVER_HOME, trash: process.env.LIVESAVER_TRASH_DIR }

  beforeEach(async () => {
    now.tmp = tempDir()
    const copied = copyFixtures(now.tmp.path)
    now.projects = copied.projects
    now.samples = copied.samples
    process.env.LIVESAVER_HOME = join(now.tmp.path, 'home')
    process.env.LIVESAVER_TRASH_DIR = join(now.tmp.path, 'trash')
    const config = join(now.tmp.path, 'config.json')
    writeFileSync(
      config,
      JSON.stringify({ appResources: '', vendorLibraries: [], searchRoots: [now.samples] }),
    )
    const revealed: string[] = []
    now.revealed = revealed
    now.server = await startWeb({
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
    await now.server.close()
    now.tmp.cleanup()
    for (const [key, value] of [
      ['LIVESAVER_HOME', saved.home],
      ['LIVESAVER_TRASH_DIR', saved.trash],
    ] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  function computer(): Setup {
    const engine = new ComputerEngine({ token: now.server.token, base: now.server.url })
    return {
      engine,
      request: {
        projects: [folderAt(now.projects)],
        search: [folderAt(now.samples)],
        options: OPTIONS,
      },
    }
  }

  function browser(): Setup & { readonly engine: BrowserEngine } {
    const engine = new BrowserEngine({ spawn: () => localEngineWorker({ cores: 4 }) })
    return {
      engine,
      request: {
        projects: [engine.add(uploadedFolder(now.projects), 'projects')],
        search: [engine.add(uploadedFolder(now.samples), 'search')],
        options: OPTIONS,
      },
    }
  }

  /** A browser whose user switched fixing on, with a project folder chosen for editing. */
  function editing(): Setup & {
    readonly engine: BrowserEngine
    readonly folder: MemoryDirectory
    readonly state: MemoryDirectory
  } {
    const folder = memoryFolder(now.projects)
    const state = new MemoryDirectory('')
    const storage = async () => state
    const engine = new BrowserEngine({
      spawn: () => localEngineWorker({ cores: 4, state: storage }),
      state: storage,
      writing: () => true,
    })
    return {
      engine,
      folder,
      state,
      request: {
        projects: [engine.add(folderFromHandle(folder), 'projects')],
        search: [engine.add(uploadedFolder(now.samples), 'search')],
        options: OPTIONS,
      },
    }
  }

  return { now, computer, browser, editing }
}

/** What a scan puts on the screen, without what an engine may see differently (where things lie). */
export function shown(scan: Scan) {
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
