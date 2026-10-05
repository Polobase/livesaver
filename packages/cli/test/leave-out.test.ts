/**
 * Sets of an older Live are left out when asked: by `--min-live` on the command line, and by the
 * option of the web app, for a scan and for a fix.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Inventory } from '@livesaver/plugins'
import { copyFixtures, makeProject, readSet, tempDir, writeSet } from '@livesaver/test-kit'
import { collectRun, minLiveOf } from '../src/commands/doctor.js'
import { webFix } from '../src/web/local.js'
import { webRuns } from '../src/web/local-runs.js'
import { webScan } from '../src/web/local-scan.js'
import type { WebEvent, WebRequest } from '../src/web/protocol.js'

let tmp: { path: string; cleanup: () => void }
let projects: string
let samples: string
let config: string
/** An old save of the fixtures' set that misses a sample: as Live 9 had saved it. */
let old: string
const saved = { home: process.env.LIVESAVER_HOME, trash: process.env.LIVESAVER_TRASH_DIR }

beforeEach(() => {
  tmp = tempDir()
  ;({ projects, samples } = copyFixtures(tmp.path))
  process.env.LIVESAVER_HOME = join(tmp.path, 'home')
  process.env.LIVESAVER_TRASH_DIR = join(tmp.path, 'trash')
  config = join(tmp.path, 'config.json')
  writeFileSync(
    config,
    JSON.stringify({ appResources: '', vendorLibraries: [], searchRoots: [samples] }),
  )
  const now = readSet(join(projects, 'Brokenpath Project', 'Brokenpath.als'))
  old = writeSet(
    join(makeProject(projects, 'Years Ago'), 'Years Ago.als'),
    now.replace(/Creator="Ableton Live [^"]*"/, 'Creator="Ableton Live 9.7.7"'),
  )
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

describe('--min-live', () => {
  test('takes a major version of Live, and says so of anything else', () => {
    expect([undefined, '', '0', '10', '12'].map(minLiveOf)).toEqual([0, 0, 0, 10, 12])
    for (const wrong of ['nine', '9.5', '-1'])
      expect(() => minLiveOf(wrong)).toThrow(
        `--min-live takes a major version of Live, such as 10 (got "${wrong}")`,
      )
  })

  test('leaves the sets of an older Live out of a check', async () => {
    const flags = { config, defaultSearch: false, search: [samples], full: true }
    const all = await collectRun('doctor', [projects], flags)
    expect([all.result.results.length, all.result.leftOut]).toEqual([4, 0])
    const some = await collectRun('doctor', [projects], { ...flags, minLive: '10' })
    expect([some.result.results.length, some.result.leftOut]).toEqual([3, 1])
    expect(some.result.results.map((set) => set.setPath)).not.toContain(old)
  })
})

describe('the option of the web app', () => {
  const settings = {
    get config() {
      return config
    },
    liveRunning: () => false,
    plugins: async () => ({ inventory: new Inventory([]), catalog: new Map() }),
    reveal: async () => {},
  }
  const request = (minLive?: number): WebRequest => ({
    projects: [projects],
    search: [{ path: samples, vendor: false }],
    options: { packLimitMB: 50, matchLibraryPath: false, ...(minLive ? { minLive } : {}) },
  })

  test('leaves them out of a scan: in no count and no row, and said to be', async () => {
    const scan = async (minLive?: number) => {
      const events: WebEvent[] = []
      await webScan(request(minLive), (event) => events.push(event), settings)
      const last = events.at(-1)
      if (last?.type !== 'scanned') throw new Error(JSON.stringify(last))
      return last.scan.samples
    }
    const all = await scan()
    expect([all.sets, all.leftOut, all.changingSets]).toEqual([4, 0, 2])
    const some = await scan(10)
    expect([some.sets, some.leftOut, some.changingSets]).toEqual([3, 1, 1])
    expect(some.setRows.map((row) => row.name)).not.toContain('Years Ago.als')
  })

  test('and out of a fix: the old save stays as it was', async () => {
    const before = readFileSync(old)
    const events: WebEvent[] = []
    await webFix(request(10), (event) => events.push(event), settings)
    const last = events.at(-1)
    if (last?.type !== 'fixed') throw new Error(JSON.stringify(last))
    expect([last.fixed.sets, last.fixed.errors]).toEqual([1, []])
    expect(readFileSync(old)).toEqual(before)
    // The run says what it was asked.
    expect((await webRuns()).map((run) => run.record?.options.minLive)).toEqual([10])
  })
})
