/** `plugins audit`: usage against the inventory, alternatives, unused plug-ins, uninstall impact. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { csvRecords } from '@livesaver/core'
import { createNodeHost } from '@livesaver/node'
import {
  type CatalogEntry,
  type InstalledPlugin,
  Inventory,
  vst2ToVst3Uid,
} from '@livesaver/plugins'
import {
  KICKSTART,
  liveSet,
  makeProject,
  midiClip,
  midiTrack,
  SERUM,
  tempDir,
  writeSet,
} from '@livesaver/test-kit'
import {
  auditPlugins,
  auditReports,
  auditSummary,
  nativeAlternative,
  uninstallImpact,
} from '../src/index.js'

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

describe('plug-in audit', () => {
  let tmp: { path: string; cleanup: () => void }
  beforeEach(() => {
    tmp = tempDir()
    const a = makeProject(tmp.path, 'A')
    writeSet(
      join(a, 'A.als'),
      liveSet(midiTrack({ session: [midiClip(0, 4)] }), { plugins: SERUM + SERUM }),
    )
    const b = makeProject(tmp.path, 'B')
    writeSet(join(b, 'B.als'), liveSet('', { plugins: SERUM + KICKSTART }))
  })
  afterEach(() => tmp.cleanup())

  const serumVst3 = vst2ToVst3Uid(XFSX, 'Serum')
  const inventory = new Inventory([
    entry('VST2', String(XFSX), 'Serum', false), // Intel only
    entry('VST3', serumVst3, 'Serum'),
    entry('VST3', 'f00df00df00df00df00df00df00df00d', 'Never Used'),
    entry('AU', 'aufx:dely:appl', 'Apple: AUDelay'),
    entry('AU', 'adec:vorb:appl', 'Vorbis Decoder'),
  ])
  const catalog = new Map<string, CatalogEntry>([
    [serumVst3, { devIdentifier: `device:vst3:instr:${serumVst3}`, name: 'Serum' }],
  ])

  test('usage, availability, the VST3 for an upgrade, unused plug-ins', async () => {
    const audit = await auditPlugins(createNodeHost(), { targets: [tmp.path], inventory, catalog })
    expect([audit.sets, audit.projects]).toEqual([2, 2])
    const byName = Object.fromEntries(audit.uses.map((u) => [u.ref.name, u]))
    expect(audit.uses.map((u) => u.ref.name)).toEqual(['Kickstart-64bit', 'Serum']) // missing first
    expect([byName.Serum?.state, byName.Serum?.instances, byName.Serum?.sets.size]).toEqual([
      'rosetta',
      3,
      2,
    ])
    expect(byName.Serum?.vst3).toEqual({ uid: serumVst3, name: 'Serum', verified: true })
    expect(nativeAlternative(byName.Serum as never)?.format).toBe('VST3')
    expect(byName['Kickstart-64bit']?.state).toBe('missing')
    // Apple's units and codecs are never "unused"
    expect(audit.unused.map((p) => p.name)).toEqual(['Never Used'])
    expect(auditSummary(audit)).toContain('Missing: 1   Rosetta only: 1   VST3 available: 1')
  })

  test('what breaks when a plug-in is uninstalled', async () => {
    const audit = await auditPlugins(createNodeHost(), { targets: [tmp.path], inventory, catalog })
    const impact = uninstallImpact(audit, inventory, 'serum')
    expect(impact.removes.map((p) => p.format).sort()).toEqual(['VST2', 'VST3'])
    expect(impact.breaks.map((u) => u.ref.name)).toEqual(['Serum'])
    expect(impact.projects.map((p) => p.split('/').at(-1))).toEqual(['A Project', 'B Project'])
    expect(uninstallImpact(audit, inventory, 'Never Used').breaks).toEqual([])
  })

  test('reports', async () => {
    const audit = await auditPlugins(createNodeHost(), { targets: [tmp.path], inventory, catalog })
    const files = auditReports(audit, inventory)
    expect([...files.keys()]).toEqual([
      'plugins-used.csv',
      'plugins-installed.csv',
      'plugins-audit.md',
    ])
    const used = csvRecords(files.get('plugins-used.csv') as string).records
    expect(used[0]?.Status).toBe('missing')
    expect(used.find((r) => r.Plugin === 'Serum')?.['VST3 for upgrade']).toBe(
      `Serum (${serumVst3})`,
    )
    expect(files.get('plugins-audit.md')).toContain('# Plug-in audit')
  })
})
