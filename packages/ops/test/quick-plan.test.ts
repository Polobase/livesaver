/** A quick plan (dry runs may skip the strict scan of each patched set) changes nothing else. */
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { join } from 'node:path'
import { EMPTY_REMAP } from '@livesaver/core'
import { createNodeHost } from '@livesaver/node'
import { copyFixtures, tempDir } from '@livesaver/test-kit'
import { applyWriter, DEFAULT_PACK_LIMIT, doctor, type EnvConfig, Probe } from '../src/index.js'

const ENV: EnvConfig = {
  userLibrary: '',
  factoryPacks: '',
  appResources: '',
  preferredRoots: [],
  vendorLibraries: [],
  remap: EMPTY_REMAP,
}

let tmp: { path: string; cleanup: () => void }
let project: string
let samples: string
let runs = 0
beforeEach(() => {
  tmp = tempDir()
  const copied = copyFixtures(tmp.path)
  project = join(copied.projects, 'Brokenpath Project')
  samples = copied.samples
})
afterEach(() => tmp.cleanup())

async function run(options: { quickPlan: boolean; apply?: boolean }) {
  const host = createNodeHost({ write: true })
  const probe = new Probe(host.fs, host.hash)
  const context = { id: `test-${++runs}`, dir: join(tmp.path, `run-${runs}`) }
  const { results } = await doctor(host, {
    targets: [project],
    searchRoots: [samples],
    env: ENV,
    packCopyLimit: DEFAULT_PACK_LIMIT,
    quickPlan: options.quickPlan,
    probe,
    ...(options.apply ? { writer: applyWriter(host, context, probe) } : {}),
  })
  return results
}

test('a quick plan plans the same changes', async () => {
  const strict = await run({ quickPlan: false })
  const quick = await run({ quickPlan: true })
  expect(strict[0]?.changes.length).toBe(1)
  expect(quick.map((r) => r.changes)).toEqual(strict.map((r) => r.changes))
  expect(quick.map((r) => r.counts)).toEqual(strict.map((r) => r.counts))
})

test('a set is written just the same: applying always scans strictly', async () => {
  const applied = await run({ quickPlan: true, apply: true })
  expect([applied[0]?.written, applied[0]?.error]).toEqual([true, ''])
})
