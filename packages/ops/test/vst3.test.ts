/** VST2 → VST3 runs over a project, and undo of such a run. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cpSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { EMPTY_REMAP } from '@livesaver/core'
import { createNodeHost } from '@livesaver/node'
import type { Catalog, CatalogEntry } from '@livesaver/plugins'
import { fixturesDir, readSet, tempDir } from '@livesaver/test-kit'
import { applyWriter, Probe, undoRun, upgradePlugins, upgradeReport } from '../src/index.js'

const fixtures = fixturesDir()

const CATALOG: Catalog = new Map<string, CatalogEntry>([
  [
    '5653544e694d616d6173736976650000',
    { devIdentifier: 'device:vst3:instr:5653544e-694d-616d-6173-736976650000', name: 'Massive' },
  ],
  [
    '56535458667358736572756d00000000',
    { devIdentifier: 'device:vst3:instr:56535458-6673-5873-6572-756d00000000', name: 'Serum' },
  ],
  [
    '84e8de5f9255222296fae4133c935a18',
    { devIdentifier: 'device:vst3:instr:84e8de5f-9255-2222-96fa-e4133c935a18', name: 'Omnisphere' },
  ],
])

let tmp: { path: string; cleanup: () => void }
let project: string
let setPath: string
beforeEach(() => {
  tmp = tempDir()
  project = join(tmp.path, 'VST2toVST3 Project')
  cpSync(join(fixtures, 'projects', 'VST2toVST3 Project'), project, {
    recursive: true,
    preserveTimestamps: true,
  })
  setPath = join(project, 'VST2toVST3.als')
})
afterEach(() => tmp.cleanup())

const backups = () => readdirSync(join(project, 'Backup')).filter((f) => f.endsWith('.als'))
const host = () => createNodeHost({ write: true, trashDir: join(tmp.path, 'Trash') })

function csvRows(text: string): Record<string, string>[] {
  const [head = '', ...lines] = text
    .replace(/^\ufeff/, '')
    .split('\r\n')
    .filter((l) => l)
  const cols = head.split(',')
  return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])))
}

describe('VST3 runs', () => {
  test('a dry run changes nothing', async () => {
    const before = readFileSync(setPath)
    const oldBackups = backups()
    const r = await upgradePlugins(host(), { targets: [project], catalog: CATALOG })
    expect(readFileSync(setPath)).toEqual(before)
    expect(backups()).toEqual(oldBackups)
    const rows = csvRows(upgradeReport(r.results, r.base))
    expect(rows.map((x) => [x['Plug-in'], x.Converted]).sort()).toEqual([
      ['Massive', 'yes'],
      ['Omnisphere', 'yes'],
      ['Serum', 'yes'],
    ])
  })

  test('apply writes a backup and dates the set anew; a second run changes nothing; undo restores set and date', async () => {
    const original = readFileSync(setPath)
    const mtime = statSync(setPath).mtimeMs
    const oldBackups = new Set(backups())
    const h = host()
    const probe = new Probe(h.fs, h.hash)
    const run = { id: 'vst3', dir: join(tmp.path, 'run') }
    const r = await upgradePlugins(h, {
      targets: [project],
      catalog: CATALOG,
      probe,
      writer: applyWriter(h, run, probe),
    })
    const [outcome] = r.results
    expect([outcome?.changed, outcome?.written, outcome?.error]).toEqual([true, true, ''])
    expect(statSync(setPath).mtimeMs).toBeGreaterThan(mtime)
    const created = backups().filter((b) => !oldBackups.has(b))
    expect(created).toHaveLength(1)
    expect(outcome?.backup).toBe(join(project, 'Backup', created[0] as string))
    const text = readSet(setPath)
    expect(text).not.toContain('<VstPluginInfo')
    expect(text.split('<Vst3PluginInfo').length - 1).toBe(6)

    const again = await upgradePlugins(host(), { targets: [project], catalog: CATALOG })
    expect(again.results[0]?.changed).toBe(false)

    const undo = await undoRun(host(), run, {
      userLibrary: '',
      factoryPacks: '',
      appResources: '',
      preferredRoots: [],
      vendorLibraries: [],
      remap: EMPTY_REMAP,
    })
    expect(undo.restored).toEqual([setPath])
    expect(readFileSync(setPath)).toEqual(original)
    expect(Math.abs(statSync(setPath).mtimeMs - mtime)).toBeLessThan(0.01)
  })
})
