/**
 * Plug-ins in the app without a page: what a scan says about them, the upgrade plan, an upgrade
 * and its undo, against livesaver on a temporary copy of the fixtures; and the app's advice.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PluginUseRow } from '@livesaver/ops'
import {
  type Catalog,
  type CatalogEntry,
  type InstalledPlugin,
  Inventory,
} from '@livesaver/plugins'
import { copyFixtures, readSet, tempDir, uploadedFolder } from '@livesaver/test-kit'
import { localEngineWorker } from '@livesaver/web'
import { startWeb, type WebServer } from 'livesaver'
import { createPinia, setActivePinia } from 'pinia'
import { BrowserEngine, ComputerEngine } from '../src/engine/index.js'
import { canUpgrade, pluginAdvice } from '../src/lib/plugins.js'
import { blockerLines, upgradeSum } from '../src/lib/upgrade.js'
import { useEngineStore } from '../src/stores/engine.js'
import { useHistoryStore } from '../src/stores/history.js'
import { useLibraryStore } from '../src/stores/library.js'
import { usePluginsStore } from '../src/stores/plugins.js'
import { useScanStore } from '../src/stores/scan.js'

const MASSIVE_VST3 = '5653544e694d616d6173736976650000'
const SERUM_VST3 = '56535458667358736572756d00000000'
const CATALOG: Catalog = new Map<string, CatalogEntry>([
  [MASSIVE_VST3, { devIdentifier: `device:vst3:instr:${MASSIVE_VST3}`, name: 'Massive' }],
  [SERUM_VST3, { devIdentifier: `device:vst3:instr:${SERUM_VST3}`, name: 'Serum' }],
])
const installed = (
  format: InstalledPlugin['format'],
  ident: string,
  name: string,
  native = true,
): InstalledPlugin => ({
  format,
  ident,
  name,
  path: `/Plug-Ins/${name}.${format.toLowerCase()}`,
  native,
  scanned: true,
})
/** Serum as VST2 (Intel only) and as VST3, Massive as VST3: Omnisphere is not installed at all. */
const INVENTORY = new Inventory([
  installed('VST2', '1483109208', 'Serum', false),
  installed('VST3', SERUM_VST3, 'Serum'),
  installed('VST3', MASSIVE_VST3, 'Massive'),
])

let tmp: { path: string; cleanup: () => void }
let projects: string
let server: WebServer
const saved = { home: process.env.LIVESAVER_HOME, trash: process.env.LIVESAVER_TRASH_DIR }

beforeEach(async () => {
  tmp = tempDir()
  const copied = copyFixtures(tmp.path)
  projects = copied.projects
  process.env.LIVESAVER_HOME = join(tmp.path, 'home')
  process.env.LIVESAVER_TRASH_DIR = join(tmp.path, 'trash')
  const config = join(tmp.path, 'config.json')
  writeFileSync(
    config,
    JSON.stringify({
      appResources: '',
      vendorLibraries: [],
      searchRoots: [copied.samples],
      status: { projects },
    }),
  )
  server = await startWeb({
    assets: false,
    config,
    liveRunning: () => false,
    plugins: async () => ({ inventory: INVENTORY, catalog: CATALOG }),
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

async function onComputer() {
  setActivePinia(createPinia())
  const engines = useEngineStore()
  engines.use(new ComputerEngine({ token: server.token, base: server.url }))
  await engines.load()
  const library = useLibraryStore()
  const scans = useScanStore()
  const plugins = usePluginsStore()
  if (engines.start) {
    library.init(engines.start)
    scans.restore(engines.start.last)
    plugins.restore(engines.start.last?.upgrade)
  }
  await useHistoryStore().refresh()
  return { engines, library, scans, plugins }
}

const vstSet = () => join(projects, 'VST2toVST3 Project', 'VST2toVST3.als')
const vst3Devices = () => readSet(vstSet()).split('<Vst3PluginInfo').length - 1

describe('plug-ins with livesaver on this computer', () => {
  test('a scan says which plug-ins the sets use, and whether they are installed', async () => {
    const { scans } = await onComputer()
    await scans.run()
    const view = scans.scan?.plugins
    expect(view?.inventory).toBe(true)
    expect(view?.uses.map((use) => [use.name, use.format, use.state])).toEqual([
      ['Massive', 'VST2', 'missing'],
      ['Omnisphere', 'VST2', 'missing'],
      ['Omnisphere', 'VST3', 'missing'],
      ['Serum', 'VST2', 'rosetta'],
      ['Massive', 'VST3', 'installed'],
      ['Serum', 'VST3', 'installed'],
    ])
    expect(view?.counts).toMatchObject({ used: 6, missing: 3, rosetta: 1, vst3Verified: 2 })
    expect(
      view?.installed.map((plugin) => [plugin.name, plugin.format, plugin.usedBySets]),
    ).toEqual([
      ['Massive', 'VST3', 1],
      ['Serum', 'VST2', 1],
      ['Serum', 'VST3', 1],
    ])
  })

  test('the plan is made when it is asked for; an upgrade is reviewed, done, and undone', async () => {
    const { scans, plugins } = await onComputer()
    await scans.run()
    expect(plugins.plan).toBeUndefined()
    expect(await plugins.loadPlan()).toBe(true)
    expect(plugins.plan?.plugins.map((p) => [p.plugin, p.convertibleSets, p.sets])).toEqual([
      ['Massive', 1, 1],
      ['Omnisphere', 0, 1],
      ['Serum', 1, 1],
    ])
    expect(plugins.convertible.map((p) => p.plugin)).toEqual(['Massive', 'Serum'])

    const before = readFileSync(vstSet())
    plugins.open(['Serum'])
    expect(plugins.chosen.map((p) => p.plugin)).toEqual(['Serum'])
    expect(await plugins.apply()).toBe(true)
    expect(plugins.upgraded).toMatchObject({ sets: 1, errors: [] })
    expect(vst3Devices()).toBe(4)
    expect(plugins.last?.id).toBe(plugins.upgraded?.run)
    // The sets were scanned and planned again: Serum has nothing left to convert.
    expect(plugins.convertible.map((p) => p.plugin)).toEqual(['Massive'])
    expect(
      scans.scan?.plugins.uses.some((use) => use.name === 'Serum' && use.format === 'VST2'),
    ).toBe(false)

    expect(await plugins.undo(plugins.upgraded?.run as string)).toBe(true)
    expect(plugins.undone).toMatchObject({ restored: 1, problems: [] })
    expect(readFileSync(vstSet()).equals(before)).toBe(true)
    expect([plugins.upgraded, plugins.last]).toEqual([undefined, undefined])
    expect(plugins.convertible.map((p) => p.plugin)).toEqual(['Massive', 'Serum'])
  })

  test('a page that is opened again has the plan and the last upgrade', async () => {
    const first = await onComputer()
    await first.scans.run()
    await first.plugins.loadPlan()
    first.plugins.open(['Massive', 'Serum'])
    await first.plugins.apply()
    expect(vst3Devices()).toBe(5)

    const again = await onComputer()
    expect(again.plugins.plan?.changingSets).toBe(0)
    expect(again.plugins.last).toMatchObject({ command: 'vst3', sets: 1, state: 'applied' })
  })

  test('an upgrade that cannot run says why and writes nothing', async () => {
    const { scans, plugins } = await onComputer()
    await scans.run()
    const before = readFileSync(vstSet())
    plugins.open(['Kontakt'])
    expect(await plugins.apply()).toBe(false)
    expect(plugins.failure).toEqual({
      message: 'Not a plug-in that can be upgraded: Kontakt',
      run: '',
    })
    expect(readFileSync(vstSet()).equals(before)).toBe(true)
  })
})

describe('plug-ins in the browser', () => {
  test('the sets say which plug-ins they use; installed or not is not known, nor can it upgrade', async () => {
    setActivePinia(createPinia())
    const engines = useEngineStore()
    engines.use(new BrowserEngine({ spawn: () => localEngineWorker({ cores: 4 }) }))
    await engines.load()
    const library = useLibraryStore()
    const scans = useScanStore()
    const plugins = usePluginsStore()
    library.addSources('projects', [uploadedFolder(projects)])
    await scans.run()
    expect(scans.scan?.plugins.uses.map((use) => use.state)).toEqual(
      Array.from({ length: 6 }, () => 'unknown'),
    )
    expect(await plugins.loadPlan()).toBe(false)
    expect(plugins.problem).toBe('Planning an upgrade of plug-ins is not possible here.')
  })
})

describe('advice for a plug-in', () => {
  const use = (extra: Partial<PluginUseRow>): PluginUseRow => ({
    key: 'k',
    format: 'VST2',
    ident: '1483109208',
    code: 'XfsX',
    name: 'Serum',
    state: 'installed',
    instances: 1,
    sets: [],
    projects: [],
    found: [],
    installedAt: [],
    failedBundle: '',
    alternatives: [],
    ...extra,
  })
  const vst3 = { uid: SERUM_VST3, name: 'Serum', verified: true }

  test('says what to do, the most useful first', () => {
    expect(pluginAdvice(use({}))).toEqual(['Nothing to do: Live loads it.'])
    expect(pluginAdvice(use({ state: 'missing' }))[0]).toContain('Live finds no VST2 plug-in')
    expect(
      pluginAdvice(use({ state: 'missing', failedBundle: '/Plug-Ins/Serum.vst' }))[0],
    ).toContain('Live could not load it: /Plug-Ins/Serum.vst')
    const upgradable = use({ state: 'rosetta', vst3 })
    expect(canUpgrade(upgradable)).toBe(true)
    expect(pluginAdvice(upgradable).map((line) => line.slice(0, 24))).toEqual([
      'It contains Intel code o',
      'Its VST3 is installed, a',
    ])
    expect(pluginAdvice(use({ vst3: { ...vst3, verified: false } }))[0]).toContain('not verified')
    const au = {
      format: 'AU' as const,
      ident: 'a',
      name: 'Serum',
      native: true,
      link: 'au-code' as const,
      paths: [],
    }
    expect(pluginAdvice(use({ state: 'missing', nativeAlternative: au }))[1]).toContain(
      'It is installed as AU',
    )
    expect(pluginAdvice(use({ state: 'unknown' }))).toHaveLength(1)
  })
})

describe('the sum of an upgrade', () => {
  const row = (set: string, plugin: string, converted: boolean, instances = 1) => ({
    project: 'P',
    set,
    root: '/music/P',
    live: '12',
    plugin,
    instances,
    converted,
    blockers: [],
    selectionsReset: converted ? 1 : 0,
    written: false,
    backup: '',
    error: '',
  })
  const plan = {
    base: '/music',
    seconds: 1,
    sets: 3,
    changingSets: 2,
    plugins: [],
    unverified: [],
    rows: [
      row('A.als', 'Serum', true, 2),
      row('A.als', 'Massive', true),
      row('B.als', 'Serum', true),
      row('C.als', 'Serum', false, 4),
    ],
  }

  test('counts a set once, and only what converts of the chosen plug-ins', () => {
    expect(upgradeSum(plan, ['Serum', 'Massive'])).toEqual({
      sets: 2,
      instances: 4,
      selectionsReset: 3,
      projects: 1,
    })
    expect(upgradeSum(plan, ['Massive'])).toMatchObject({ sets: 1, instances: 1 })
    expect(upgradeSum(plan, [])).toMatchObject({ sets: 0, instances: 0 })
  })

  test('what stands in the way is said with its number', () => {
    const blocked = {
      plugin: 'Omnisphere',
      sets: 232,
      convertibleSets: 0,
      instances: 1307,
      convertibleInstances: 0,
      selectionsReset: 0,
      blockers: [
        { blocker: 'old_format' as const, reason: 'file format without VST3', instances: 1275 },
        { blocker: 'rack' as const, reason: 'inside a rack', instances: 1 },
      ],
    }
    expect(blockerLines(blocked)).toEqual([
      '1,275 instances: file format without VST3',
      '1 instance: inside a rack',
    ])
  })
})
