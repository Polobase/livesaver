/** The plug-in audit and an upgrade as plain data for a page. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cpSync } from 'node:fs'
import { join } from 'node:path'
import { EMPTY_REMAP, inProcessParser } from '@livesaver/core'
import { createNodeHost } from '@livesaver/node'
import {
  type Catalog,
  type CatalogEntry,
  type InstalledPlugin,
  Inventory,
  vst2ToVst3Uid,
} from '@livesaver/plugins'
import {
  fixturesDir,
  KICKSTART,
  liveSet,
  makeProject,
  SERUM,
  tempDir,
  writeFile,
  writeSet,
} from '@livesaver/test-kit'
import {
  auditPlugins,
  auditSets,
  doctor,
  type EnvConfig,
  pluginsView,
  uninstallView,
  upgradePlugins,
  upgradeView,
} from '../src/index.js'

const ENV: EnvConfig = {
  userLibrary: '',
  factoryPacks: '',
  appResources: '',
  preferredRoots: [],
  vendorLibraries: [],
  remap: EMPTY_REMAP,
}

const XFSX = 1483109208
const entry = (
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

let tmp: { path: string; cleanup: () => void }
beforeEach(() => {
  tmp = tempDir()
})
afterEach(() => tmp.cleanup())

describe('the audit as a view', () => {
  const serumVst3 = vst2ToVst3Uid(XFSX, 'Serum')
  const inventory = new Inventory([
    entry('VST2', String(XFSX), 'Serum', false), // Intel only
    entry('VST3', serumVst3, 'Serum'),
    entry('VST3', 'f00df00df00df00df00df00df00df00d', 'Never Used'),
    entry('AU', 'adec:vorb:appl', 'Vorbis Decoder'),
  ])
  const catalog = new Map<string, CatalogEntry>([
    [serumVst3, { devIdentifier: `device:vst3:instr:${serumVst3}`, name: 'Serum' }],
  ])

  const audit = async (known = inventory) => {
    writeSet(join(makeProject(tmp.path, 'A'), 'A.als'), liveSet('', { plugins: SERUM + SERUM }))
    writeSet(join(makeProject(tmp.path, 'B'), 'B.als'), liveSet('', { plugins: SERUM + KICKSTART }))
    return auditPlugins(createNodeHost(), { targets: [tmp.path], inventory: known, catalog })
  }

  test('rows for what is used and what is installed, and the counts of the overview', async () => {
    const view = pluginsView(await audit(), inventory)
    expect([view.sets, view.projects, view.inventory]).toEqual([2, 2, true])
    expect(view.counts).toEqual({
      used: 2,
      missing: 1,
      rosetta: 1,
      nativeAlternative: 1,
      vst3: 1,
      vst3Verified: 1,
      unused: 1,
    })
    const serum = view.uses.find((u) => u.name === 'Serum')
    expect(serum).toMatchObject({
      format: 'VST2',
      code: 'XfsX',
      state: 'rosetta',
      instances: 3,
      sets: ['A Project/A.als', 'B Project/B.als'],
      projects: ['A Project', 'B Project'],
      found: [`VST2\u0000${XFSX}`],
      installedAt: ['/Plug-Ins/Serum.vst2'],
      vst3: { uid: serumVst3, name: 'Serum', verified: true },
    })
    expect(serum?.nativeAlternative).toMatchObject({ format: 'VST3', native: true })
    expect(view.uses.map((u) => [u.name, u.state])).toEqual([
      ['Kickstart-64bit', 'missing'],
      ['Serum', 'rosetta'],
    ])
    expect(view.installed.map((p) => [p.name, p.format, p.usedBySets, p.unused, p.device])).toEqual(
      [
        ['Never Used', 'VST3', 0, true, true],
        ['Serum', 'VST2', 2, false, true],
        ['Serum', 'VST3', 0, false, true],
        // A codec is no device of Live, and Apple's own units are never "unused".
        ['Vorbis Decoder', 'AU', 0, false, false],
      ],
    )
    // Plain data: it survives the way to a page as it is.
    expect(JSON.parse(JSON.stringify(view))).toEqual(view)
  })

  test('without knowing what is installed, it only says what is used, and where', async () => {
    const view = pluginsView(await audit(new Inventory([])), undefined)
    expect(view.inventory).toBe(false)
    // With no state to sort by, the plug-in used in most projects comes first.
    expect(view.uses.map((u) => [u.name, u.state, u.instances])).toEqual([
      ['Serum', 'unknown', 3],
      ['Kickstart-64bit', 'unknown', 1],
    ])
    expect(view.installed).toEqual([])
    expect([view.counts.missing, view.counts.rosetta, view.counts.used]).toEqual([0, 0, 2])
  })

  test('a check of the samples has read the plug-ins too: the same audit, no second reading', async () => {
    const again = await audit()
    const host = createNodeHost()
    const check = await doctor(host, { targets: [tmp.path], searchRoots: [], env: ENV })
    const sets = check.results.map(({ setPath, projectRoot, plugins }) => ({
      setPath,
      projectRoot,
      ...(plugins ? { plugins } : {}),
    }))
    const fromCheck = auditSets(sets, check.base, { inventory, catalog })
    expect(pluginsView(fromCheck, inventory)).toEqual(pluginsView(again, inventory))
    // A set that could not be read says nothing about plug-ins, and is listed as such.
    writeFile(join(makeProject(tmp.path, 'C'), 'C.als'), 'not a set')
    const broken = await auditPlugins(host, { targets: [tmp.path], inventory, catalog })
    expect(pluginsView(broken, inventory).unreadable).toEqual(['C Project/C.als'])
    expect([broken.sets, broken.projects]).toEqual([3, 2])
  })

  test('what breaks when a plug-in is uninstalled, from the view alone', async () => {
    const view = pluginsView(await audit(), inventory)
    const serum = uninstallView(view, 'serum')
    expect(serum.removes.map((p) => p.format)).toEqual(['VST2', 'VST3'])
    expect(serum.breaks.map((u) => u.name)).toEqual(['Serum'])
    expect([serum.sets, serum.projects]).toEqual([
      ['A Project/A.als', 'B Project/B.als'],
      ['A Project', 'B Project'],
    ])
    const unused = uninstallView(view, 'Never Used')
    expect([unused.removes.length, unused.breaks.length]).toEqual([1, 0])
    expect(uninstallView(view, 'No Such Thing').removes).toEqual([])
  })
})

describe('an upgrade as a view', () => {
  const CATALOG: Catalog = new Map<string, CatalogEntry>([
    [
      '5653544e694d616d6173736976650000',
      { devIdentifier: 'device:vst3:instr:5653544e-694d-616d-6173-736976650000', name: 'Massive' },
    ],
    [
      '56535458667358736572756d00000000',
      { devIdentifier: 'device:vst3:instr:56535458-6673-5873-6572-756d00000000', name: 'Serum' },
    ],
  ])

  test('per plug-in what converts, and why the rest does not', async () => {
    const project = join(tmp.path, 'VST2toVST3 Project')
    cpSync(join(fixturesDir(), 'projects', 'VST2toVST3 Project'), project, { recursive: true })
    const view = upgradeView(
      await upgradePlugins(createNodeHost(), { targets: [project], catalog: CATALOG }),
    )
    expect([view.sets, view.changingSets]).toEqual([1, 1])
    expect(view.plugins.map((p) => [p.plugin, p.convertibleSets, p.sets, p.blockers])).toEqual([
      ['Massive', 1, 1, []],
      // Its VST3 is not in the catalog here.
      ['Omnisphere', 0, 1, [{ blocker: 'no_vst3', reason: 'VST3 not installed', instances: 1 }]],
      ['Serum', 1, 1, []],
    ])
    expect(view.rows.map((r) => [r.project, r.set, r.plugin, r.converted, r.written])).toEqual([
      ['VST2toVST3 Project', 'VST2toVST3.als', 'Omnisphere', false, false],
      ['VST2toVST3 Project', 'VST2toVST3.als', 'Serum', true, false],
      ['VST2toVST3 Project', 'VST2toVST3.als', 'Massive', true, false],
    ])
    expect(view.rows[0]?.root).toBe(project)
    expect(JSON.parse(JSON.stringify(view))).toEqual(view)
  })

  test('sets known to have no VST2 plug-in are not read, and the plan is the same', async () => {
    const project = join(tmp.path, 'VST2toVST3 Project')
    cpSync(join(fixturesDir(), 'projects', 'VST2toVST3 Project'), project, { recursive: true })
    const empty = join(makeProject(tmp.path, 'Empty'), 'Empty.als')
    writeSet(empty, liveSet())
    const host = createNodeHost()
    const all = await upgradePlugins(host, { targets: [tmp.path], catalog: CATALOG })
    const read: string[] = []
    const inner = inProcessParser(host)
    const some = await upgradePlugins(host, {
      targets: [tmp.path],
      catalog: CATALOG,
      skip: (path) => path === empty,
      parser: {
        parse: (path) => {
          read.push(path)
          return inner.parse(path)
        },
        close: async () => {},
      },
    })
    expect(read).toEqual([join(project, 'VST2toVST3.als')])
    expect(some.results.map((r) => r.setPath)).toEqual(all.results.map((r) => r.setPath))
    const { seconds: _a, ...planned } = upgradeView(all)
    const { seconds: _b, ...skipped } = upgradeView(some)
    // Only the Live version of the set that was not read is unknown; it has no row anyway.
    expect(skipped).toEqual(planned)
  })
})
