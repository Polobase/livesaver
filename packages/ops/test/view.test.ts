/** A check's result as a page shows it: totals, and a row per project, set and change. */
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { EMPTY_REMAP, liveCrc } from '@livesaver/core'
import { createNodeHost } from '@livesaver/node'
import {
  copyFixtures,
  deviceSet,
  makeProject,
  tempDir,
  writeFile,
  writeSet,
} from '@livesaver/test-kit'
import {
  checkView,
  DEFAULT_PACK_LIMIT,
  type DoctorOptions,
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

async function view(search: string[], options: Partial<DoctorOptions> = {}) {
  const host = createNodeHost()
  const probe = new Probe(host.fs, host.hash)
  const env = options.env ?? ENV
  const result = await doctor(host, {
    targets: [projects],
    searchRoots: search,
    env,
    packCopyLimit: DEFAULT_PACK_LIMIT,
    probe,
    ...options,
  })
  return checkView(result, new Environment(env, probe))
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
      certain: { changingSets: 1, changes: 1, copyFiles: 1, copyBytes: 2000324 },
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
      certain: { changingSets: 0, changes: 0, copyFiles: 0, copyBytes: 0 },
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
      certain: { changingSets: 0, changes: 0, copyFiles: 0, copyBytes: 0 },
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

test('the plan says what a fix does without the uncertain matches, and such a fix does that', async () => {
  const shaker = join('Drum Library', 'Samples', 'Drums', 'Shaker', 'Shaker 1.wav')
  const library = join(tmp.path, 'NI')
  // A library whose file was re-tagged since: the same sound with another fingerprint.
  const old = new TextEncoder().encode(`RIFF${'shaker '.repeat(400)}tags 1.0`)
  const installed = new TextEncoder().encode(`RIFF${'shaker '.repeat(400)}tags 1.1!`)
  writeFile(join(library, shaker), installed)
  const stored = `/Volumes/Old Disk/Maschine Library/${shaker}`
  const set = (project: string, name: string, bytes: Uint8Array) =>
    writeSet(
      join(project, name),
      deviceSet(stored, bytes.length, liveCrc(bytes)).replaceAll('MxPatchRef', 'SampleRef'),
    )
  // "Both" needs the file for a certain match and for an uncertain one; "Old" only for the latter.
  const both = makeProject(projects, 'Both')
  set(both, 'Made with 1.0.als', old)
  set(both, 'Made with 1.1.als', installed)
  set(makeProject(projects, 'Old'), 'Old.als', old)
  const options = {
    env: { ...ENV, vendorLibraries: [library] },
    excludes: ['Brokenpath', 'Fixed Path', 'VST2toVST3'].map((p) => join(projects, `${p} Project`)),
    matchLibraryPath: true,
  }

  const plan = await view([library], options)
  const numbers = (v: typeof plan) =>
    v.projectRows.map((p) => [p.path, p.changingSets, p.changes, p.uncertain, p.copyFiles])
  expect(numbers(plan)).toEqual([
    ['Both Project', 2, 2, 1, 1],
    ['Old Project', 1, 1, 1, 1],
  ])
  expect(plan.projectRows.map((p) => p.certain)).toEqual([
    { changingSets: 1, changes: 1, copyFiles: 1, copyBytes: installed.length },
    { changingSets: 0, changes: 0, copyFiles: 0, copyBytes: 0 },
  ])
  expect(plan.certain).toEqual({
    changingSets: 1,
    changes: 1,
    copyFiles: 1,
    copyBytes: installed.length,
  })

  const certain = await view([library], { ...options, certainOnly: true })
  expect(numbers(certain)).toEqual([
    ['Both Project', 1, 1, 0, 1],
    ['Old Project', 0, 0, 0, 0],
  ])
  expect([certain.changingSets, certain.copyFiles, certain.copyBytes, certain.uncertain]).toEqual([
    plan.certain.changingSets,
    plan.certain.copyFiles,
    plan.certain.copyBytes,
    0,
  ])
  // What was left out stays missing, with the file that was not taken as its candidate.
  expect(certain.counts.mismatch).toBe(2)
  expect(certain.missing.map((m) => [m.status, m.name, m.sets, m.candidates])).toEqual([
    ['mismatch', 'Shaker 1.wav', 2, [join(library, shaker)]],
  ])
})
