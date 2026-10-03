/** A check's result as a page shows it: totals, and a row per project, set and change. */
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { EMPTY_REMAP } from '@livesaver/core'
import { createNodeHost } from '@livesaver/node'
import { copyFixtures, tempDir } from '@livesaver/test-kit'
import {
  checkView,
  DEFAULT_PACK_LIMIT,
  doctor,
  type EnvConfig,
  Environment,
  Probe,
} from '../src/index.js'

const ENV: EnvConfig = {
  userLibrary: '',
  factoryPacks: '',
  appResources: '',
  preferredRoots: [],
  vendorLibraries: [],
  remap: EMPTY_REMAP,
}

let tmp: { path: string; cleanup: () => void }
let projects: string
let samples: string
beforeEach(() => {
  tmp = tempDir()
  ;({ projects, samples } = copyFixtures(tmp.path))
})
afterEach(() => tmp.cleanup())

async function view(search: string[]) {
  const host = createNodeHost()
  const probe = new Probe(host.fs, host.hash)
  const result = await doctor(host, {
    targets: [projects],
    searchRoots: search,
    env: ENV,
    packCopyLimit: DEFAULT_PACK_LIMIT,
    probe,
  })
  return checkView(result, new Environment(ENV, probe))
}

test('every project has a row with what a fix of it does', async () => {
  const v = await view([samples])
  expect(v.projectRows).toEqual([
    {
      root: join(projects, 'Brokenpath Project'),
      path: 'Brokenpath Project',
      sets: 1,
      completeSets: 1,
      changingSets: 1,
      changes: 1,
      uncertain: 0,
      missing: 0,
      copyFiles: 1,
      copyBytes: 2000324,
      errors: 0,
    },
    {
      root: join(projects, 'Fixed Path Project'),
      path: 'Fixed Path Project',
      sets: 1,
      completeSets: 1,
      changingSets: 0,
      changes: 0,
      uncertain: 0,
      missing: 0,
      copyFiles: 0,
      copyBytes: 0,
      errors: 0,
    },
    {
      root: join(projects, 'VST2toVST3 Project'),
      path: 'VST2toVST3 Project',
      sets: 1,
      completeSets: 1,
      changingSets: 0,
      changes: 0,
      uncertain: 0,
      missing: 0,
      copyFiles: 0,
      copyBytes: 0,
      errors: 0,
    },
  ])
  expect([v.projects, v.completeProjects, v.sets, v.completeSets, v.changingSets]).toEqual([
    3, 3, 3, 3, 1,
  ])
  expect([v.copyFiles, v.copyBytes, v.uncertain]).toEqual([1, 2000324, 0])
  expect(v.changes.map((c) => [c.project, c.set, c.action, c.newPath])).toEqual([
    ['Brokenpath Project', 'Brokenpath.als', 'repaired', 'Samples/Imported/1.wav'],
  ])
})

test('what stays missing is counted per project, and the totals add up', async () => {
  rmSync(join(samples, 'Lib1'), { recursive: true })
  rmSync(join(samples, 'Lib2'), { recursive: true })
  const v = await view([samples])
  const broken = v.projectRows.find((p) => p.path === 'Brokenpath Project')
  expect(broken).toMatchObject({ completeSets: 0, changingSets: 0, changes: 0, missing: 1 })
  expect([v.completeProjects, v.completeSets, v.counts['not-found']]).toEqual([2, 2, 1])
  expect(v.missing.map((m) => [m.status, m.name, m.sets, m.projects])).toEqual([
    ['not-found', '1.wav', 1, 1],
  ])
  expect(v.missingSources[0]?.hint).toContain('--search')
})
