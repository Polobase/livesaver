/**
 * What the web app asks of this computer beyond a check: a scan of samples and plug-ins, an
 * upgrade of plug-ins with its undo, a fix without the uncertain matches, and the history.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { liveCrc } from '@livesaver/core'
import {
  type Catalog,
  type CatalogEntry,
  type InstalledPlugin,
  Inventory,
} from '@livesaver/plugins'
import {
  copyFixtures,
  deviceSet,
  makeProject,
  readSet,
  tempDir,
  writeFile,
  writeSet,
} from '@livesaver/test-kit'
import { webCheck, webFix, webUndo } from '../src/web/local.js'
import { canReveal, webReport, webReveal, webRun, webRuns } from '../src/web/local-runs.js'
import { type ScanNotes, webScan, webUpgrade, webUpgradePlan } from '../src/web/local-scan.js'
import type { WebEvent, WebRequest, WebScan, WebUpgraded } from '../src/web/protocol.js'

const MASSIVE_VST3 = '5653544e694d616d6173736976650000'
const SERUM_VST3 = '56535458667358736572756d00000000'
const CATALOG: Catalog = new Map<string, CatalogEntry>([
  [MASSIVE_VST3, { devIdentifier: `device:vst3:instr:${MASSIVE_VST3}`, name: 'Massive' }],
  [SERUM_VST3, { devIdentifier: `device:vst3:instr:${SERUM_VST3}`, name: 'Serum' }],
])
const plugin = (
  format: InstalledPlugin['format'],
  ident: string,
  name: string,
): InstalledPlugin => ({
  format,
  ident,
  name,
  path: `/Plug-Ins/${name}.${format.toLowerCase()}`,
  native: true,
  scanned: true,
})
const INVENTORY = new Inventory([
  plugin('VST3', MASSIVE_VST3, 'Massive'),
  plugin('VST3', SERUM_VST3, 'Serum'),
])

let tmp: { path: string; cleanup: () => void }
let projects: string
let samples: string
let revealed: string[]
let settings: {
  config: string
  liveRunning: () => boolean
  plugins: () => Promise<{ inventory: Inventory; catalog: Catalog }>
  reveal: (path: string) => Promise<void>
}
const saved = { home: process.env.LIVESAVER_HOME, trash: process.env.LIVESAVER_TRASH_DIR }

beforeEach(() => {
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
  settings = {
    config,
    liveRunning: () => false,
    plugins: async () => ({ inventory: INVENTORY, catalog: CATALOG }),
    reveal: async (path) => {
      revealed.push(path)
    },
  }
})
afterEach(() => {
  tmp.cleanup()
  for (const [key, value] of [
    ['LIVESAVER_HOME', saved.home],
    ['LIVESAVER_TRASH_DIR', saved.trash],
  ] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

const request = (extra: Partial<WebRequest> = {}): WebRequest => ({
  projects: [projects],
  search: [{ path: samples, vendor: false }],
  options: { packLimitMB: 50, matchLibraryPath: false },
  ...extra,
})

async function scan(
  req = request(),
): Promise<{ events: WebEvent[]; scan: WebScan; notes: ScanNotes | undefined }> {
  const events: WebEvent[] = []
  const notes = await webScan(req, (event) => events.push(event), settings)
  const last = events.at(-1)
  if (last?.type !== 'scanned') throw new Error(JSON.stringify(last))
  return { events, scan: last.scan, notes }
}

async function plan(extra: object = {}, notes?: ScanNotes) {
  const events: WebEvent[] = []
  await webUpgradePlan({ projects: [projects], ...extra }, (e) => events.push(e), settings, notes)
  const last = events.at(-1)
  if (last?.type !== 'planned') throw new Error(JSON.stringify(last))
  return { events, upgrade: last.upgrade }
}

async function upgrade(extra = {}): Promise<{ events: WebEvent[]; upgraded: WebUpgraded }> {
  const events: WebEvent[] = []
  await webUpgrade({ projects: [projects], ...extra }, (event) => events.push(event), settings)
  const last = events.at(-1)
  if (last?.type !== 'upgraded') throw new Error(JSON.stringify(last))
  return { events, upgraded: last.upgraded }
}

const vstSet = () => join(projects, 'VST2toVST3 Project', 'VST2toVST3.als')

describe('a scan', () => {
  test('is the check of the samples and the plug-ins of every set, read once', async () => {
    const { events, scan: found } = await scan()
    expect(
      events.filter((e) => e.type === 'phase').map((e) => e.type === 'phase' && e.phase),
    ).toEqual(['indexing', 'checking', 'plugins', 'reporting'])
    // The samples: what a check alone finds.
    const checked: WebEvent[] = []
    await webCheck(request(), (event) => checked.push(event), settings)
    const done = checked.at(-1)
    const { seconds: _a, ...samplesOfScan } = found.samples
    const { seconds: _b, ...samplesOfCheck } = done?.type === 'done' ? done.result : ({} as never)
    expect(samplesOfScan).toEqual(samplesOfCheck)

    expect([found.plugins.sets, found.plugins.inventory]).toEqual([3, true])
    expect(found.plugins.uses.map((u) => [u.name, u.format, u.state, u.sets])).toEqual([
      // What is missing comes first.
      ['Massive', 'VST2', 'missing', ['VST2toVST3 Project/VST2toVST3.als']],
      ['Omnisphere', 'VST2', 'missing', ['VST2toVST3 Project/VST2toVST3.als']],
      ['Omnisphere', 'VST3', 'missing', ['VST2toVST3 Project/VST2toVST3.als']],
      ['Serum', 'VST2', 'missing', ['VST2toVST3 Project/VST2toVST3.als']],
      ['Massive', 'VST3', 'installed', ['VST2toVST3 Project/VST2toVST3.als']],
      ['Serum', 'VST3', 'installed', ['VST2toVST3 Project/VST2toVST3.als']],
    ])
    expect(found.plugins.counts).toMatchObject({ used: 6, missing: 4, vst3Verified: 2 })

    expect(Object.keys(found.seconds).sort()).toEqual([
      'checking',
      'indexing',
      'plugins',
      'reporting',
    ])
    // A scan plans, and a plan leaves no run behind.
    expect(await webRuns()).toEqual([])
  })

  test('a failure is an event, not an exception', async () => {
    const events: WebEvent[] = []
    const notes = await webScan(request({ projects: [] }), (event) => events.push(event), settings)
    expect(events).toEqual([{ type: 'failed', message: 'No project folder was given.' }])
    expect(notes).toBeUndefined()
  })
})

describe('the plan of an upgrade', () => {
  test('says what converts; after a scan only the sets with VST2 plug-ins are read', async () => {
    const { notes } = await scan()
    expect([...(notes?.vst2.keys() ?? [])]).toEqual([vstSet()])
    const alone = await plan()
    const afterScan = await plan({}, notes)
    expect([alone.upgrade.sets, alone.upgrade.changingSets]).toEqual([3, 1])
    expect(alone.upgrade.plugins.map((p) => [p.plugin, p.convertibleInstances])).toEqual([
      ['Massive', 1],
      ['Omnisphere', 0],
      ['Serum', 1],
    ])
    const { seconds: _a, ...first } = alone.upgrade
    const { seconds: _b, ...second } = afterScan.upgrade
    expect(second).toEqual(first)
    expect(afterScan.events.filter((e) => e.type === 'progress').length).toBe(3)
    // A plan writes nothing and leaves no run behind.
    expect(await webRuns()).toEqual([])
  })

  test('without a VST3 in Live there is nothing to plan, and it says so', async () => {
    settings.plugins = async () => ({ inventory: new Inventory([]), catalog: new Map() })
    const events: WebEvent[] = []
    await webUpgradePlan({ projects: [projects] }, (event) => events.push(event), settings)
    expect(events.at(-1)).toEqual({
      type: 'failed',
      message: "No VST3 plug-ins in Live's plug-in database.",
    })
  })
})

describe('an upgrade of plug-ins', () => {
  test('rewrites the sets, is in the history with its report, and is undone', async () => {
    const before = readFileSync(vstSet())
    const { events, upgraded } = await upgrade()
    expect(events[0]).toEqual({ type: 'phase', phase: 'upgrading' })
    expect(events.filter((e) => e.type === 'progress').length).toBe(3)
    expect([upgraded.sets, upgraded.errors, upgraded.upgrade.changingSets]).toEqual([1, [], 1])
    expect(upgraded.upgrade.rows.map((r) => [r.plugin, r.converted, r.written])).toEqual([
      ['Omnisphere', false, true],
      ['Serum', true, true],
      ['Massive', true, true],
    ])
    expect(readSet(vstSet()).split('<Vst3PluginInfo').length - 1).toBe(5)

    const [run] = await webRuns()
    expect(run).toMatchObject({
      id: upgraded.run,
      command: 'vst3',
      applied: true,
      state: 'applied',
      sets: 1,
      canUndo: true,
      reports: ['vst3_upgrade.csv'],
    })
    expect(run?.record).toMatchObject({ targets: [projects], outcome: { sets: 3, written: 1 } })
    const detail = await webRun(upgraded.run)
    expect(detail.steps.map((step) => [step.op, step.path, step.finished])).toEqual([
      ['write-set', vstSet(), true],
    ])
    expect(existsSync(detail.steps[0]?.backup ?? '')).toBe(true)
    expect(webReport(upgraded.run, 'vst3_upgrade.csv')).toContain('Massive')

    const undone = await webUndo(upgraded.run, settings)
    expect([undone.restored, undone.problems]).toEqual([1, []])
    expect(readFileSync(vstSet())).toEqual(before)
    expect((await webRuns())[0]).toMatchObject({ state: 'undone', canUndo: false })
  })

  test('of chosen plug-ins, or of some projects; what cannot be asked is refused', async () => {
    const { upgraded } = await upgrade({ plugins: ['serum'] })
    expect(upgraded.upgrade.rows.map((r) => [r.plugin, r.converted])).toEqual([['Serum', true]])
    const other = await upgrade({ only: join(projects, 'Fixed Path Project') })
    expect([other.upgraded.sets, other.upgraded.upgrade.sets]).toEqual([0, 1])
    const two = await upgrade({
      only: [join(projects, 'Fixed Path Project'), join(projects, 'Brokenpath Project')],
    })
    expect(two.upgraded.upgrade.sets).toBe(2)

    const refused = async (extra: object) => {
      const events: WebEvent[] = []
      await webUpgrade({ projects: [projects], ...extra }, (event) => events.push(event), settings)
      return events
    }
    expect(await refused({ plugins: ['Kontakt'] })).toEqual([
      { type: 'failed', message: 'Not a plug-in that can be upgraded: Kontakt' },
    ])
    expect((await refused({ only: tmp.path }))[0]).toMatchObject({ type: 'failed' })
  })
})

describe('a fix without the uncertain matches', () => {
  test('leaves a sample whose file is not confirmed as it is', async () => {
    const shaker = join('Drum Library', 'Samples', 'Drums', 'Shaker', 'Shaker 1.wav')
    const library = join(tmp.path, 'NI')
    const old = new TextEncoder().encode(`RIFF${'shaker '.repeat(400)}tags 1.0`)
    writeFile(join(library, shaker), `RIFF${'shaker '.repeat(400)}tags 1.1!`)
    const song = join(makeProject(projects, 'Song'), 'Song.als')
    const stored = `/Volumes/Old Disk/Maschine Library/${shaker}`
    writeSet(
      song,
      deviceSet(stored, old.length, liveCrc(old)).replaceAll('MxPatchRef', 'SampleRef'),
    )
    const asked = {
      ...request({
        search: [
          { path: samples, vendor: false },
          { path: library, vendor: true },
        ],
        options: { packLimitMB: 50, matchLibraryPath: true },
      }),
      only: join(projects, 'Song Project'),
    }
    const fix = async (certainOnly: boolean) => {
      const events: WebEvent[] = []
      await webFix({ ...asked, certainOnly }, (event) => events.push(event), settings)
      const last = events.at(-1)
      if (last?.type !== 'fixed') throw new Error(JSON.stringify(last))
      return last.fixed
    }
    const original = readFileSync(song)
    expect(await fix(true)).toMatchObject({ sets: 0, files: 0 })
    expect(readFileSync(song)).toEqual(original)
    expect(await fix(false)).toMatchObject({ sets: 1, files: 1 })
    // The run folder says what it was asked.
    const runs = await webRuns()
    expect(runs.map((run) => run.record?.options.certainOnly)).toEqual([false, true])
  })
})

describe('showing a file', () => {
  test('asks the system for a file that exists, and for nothing else', async () => {
    expect(canReveal(settings)).toBe(true)
    await webReveal(vstSet(), settings)
    expect(revealed).toEqual([vstSet()])
    expect(webReveal(join(tmp.path, 'nothing.als'), settings)).rejects.toThrow('does not exist')
    expect(webReveal('relative.als', settings)).rejects.toThrow('does not exist')
    expect(revealed.length).toBe(1)
  })
})

describe('the history', () => {
  test('a run that is not there, or a file that is no report of it, is refused', async () => {
    const { upgraded } = await upgrade()
    expect(webRun('nothing')).rejects.toThrow('no such run')
    expect(webRun('../config.json')).rejects.toThrow('no such run')
    expect(() => webReport(upgraded.run, 'journal.jsonl')).toThrow('no such report')
    expect(() => webReport(upgraded.run, '../../config.json')).toThrow('no such report')
  })
})
