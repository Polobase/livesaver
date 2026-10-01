/** Undo of applied runs, and the complete-sets cache. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { EMPTY_REMAP } from '@livesaver/core'
import { createNodeHost } from '@livesaver/node'
import { copyFixtures, tempDir, writeFile } from '@livesaver/test-kit'
import {
  applyWriter,
  buildReports,
  CompleteSets,
  DEFAULT_PACK_LIMIT,
  doctor,
  type EnvConfig,
  Probe,
  type RunContext,
  undoRun,
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
let n = 0
beforeEach(() => {
  tmp = tempDir()
})
afterEach(() => tmp.cleanup())

function host() {
  return createNodeHost({ write: true, trashDir: join(tmp.path, 'Trash') })
}

async function apply(targets: string[], search: string[]): Promise<RunContext> {
  const h = host()
  const probe = new Probe(h.fs, h.hash)
  const run = { id: `r${++n}`, dir: join(tmp.path, 'runs', `r${n}`) }
  const result = await doctor(h, {
    targets,
    searchRoots: search,
    env: ENV,
    probe,
    writer: applyWriter(h, run, probe),
  })
  expect(result.results.every((r) => !r.error)).toBe(true)
  return run
}

describe('undo', () => {
  let project: string
  let samples: string
  let setPath: string
  beforeEach(() => {
    const copied = copyFixtures(tmp.path)
    samples = copied.samples
    project = join(copied.projects, 'Brokenpath Project')
    setPath = join(project, 'Brokenpath.als')
  })

  test('restores the set byte for byte and trashes the unused copies', async () => {
    const original = readFileSync(setPath)
    const mtime = statSync(setPath).mtimeMs
    const run = await apply([project], [samples])
    expect(readFileSync(setPath)).not.toEqual(original)
    const report = await undoRun(host(), run, ENV)
    expect(report.restored).toEqual([setPath])
    expect(readFileSync(setPath)).toEqual(original)
    expect(Math.abs(statSync(setPath).mtimeMs - mtime)).toBeLessThan(0.01)
    const copy = join(project, 'Samples', 'Imported', '1.wav')
    expect(report.trashed.sort()).toEqual([copy, `${copy}.asd`])
    expect(existsSync(copy)).toBe(false)
    expect(readdirSync(join(tmp.path, 'Trash')).sort()).toEqual(['1.wav', '1.wav.asd'])
    // The Live-style backup stays: undo never deletes.
    expect(readdirSync(join(project, 'Backup')).some((f) => f.startsWith('Brokenpath ['))).toBe(
      true,
    )
    // Undoing twice is harmless.
    const again = await undoRun(host(), run, ENV)
    expect([again.restored, again.trashed]).toEqual([[], []])
  })

  test('leaves a set alone that changed after the run, and keeps copies it still uses', async () => {
    const run = await apply([project], [samples])
    const changed = readFileSync(setPath)
    const last = changed.length - 1
    changed[last] = (changed[last] as number) ^ 1 // someone saved the set again
    writeFile(setPath, changed)
    const report = await undoRun(host(), run, ENV)
    expect(report.changedSince).toEqual([setPath])
    expect(report.restored).toEqual([])
  })
})

describe('complete-sets cache', () => {
  async function check(project: string, cache: CompleteSets, search: string[] = []) {
    const h = createNodeHost()
    const probe = new Probe(h.fs, h.hash)
    const result = await doctor(h, {
      targets: [project],
      searchRoots: search,
      env: ENV,
      probe,
      cache,
    })
    return {
      result: result.results[0],
      reports: await buildReports(result.results, result.base, probe),
    }
  }

  test('a complete set is skipped until something changes', async () => {
    const { projects } = copyFixtures(tmp.path)
    const project = join(projects, 'Fixed Path Project')
    const cache = new CompleteSets(DEFAULT_PACK_LIMIT)
    const first = await check(project, cache)
    expect([first.result?.skipped, first.result?.counts.ok]).toEqual([false, 1])
    const second = await check(project, CompleteSets.parse(cache.serialize(), DEFAULT_PACK_LIMIT))
    expect(second.result?.skipped).toBe(true)
    expect(second.result?.counts).toEqual(
      first.result?.counts as NonNullable<typeof first.result>['counts'],
    )
    expect(second.reports['projects.csv']).toContain('complete (unchanged, skipped)')

    rmSync(join(project, 'Samples', 'Imported', '1.wav')) // a sample disappears
    const third = await check(project, cache)
    expect(third.result?.skipped).toBe(false)
    expect(third.result?.counts['not-found']).toBe(1) // no search roots: nothing else has it
  })

  test('an incomplete set is not remembered', async () => {
    const { projects } = copyFixtures(tmp.path)
    const project = join(projects, 'Brokenpath Project')
    const cache = new CompleteSets(DEFAULT_PACK_LIMIT)
    await check(project, cache)
    expect((await check(project, cache)).result?.skipped).toBe(false)
  })

  test('a cache from another version or a different pack limit is not trusted', async () => {
    expect(CompleteSets.parse('{"version": 2, "sets": {"/x.als": {}}}', 0).size).toBe(0)
    const { projects } = copyFixtures(tmp.path)
    const project = join(projects, 'Fixed Path Project')
    const cache = new CompleteSets(DEFAULT_PACK_LIMIT)
    await check(project, cache)
    const other = CompleteSets.parse(cache.serialize(), 1_000_000)
    expect((await check(project, other)).result?.skipped).toBe(false)
  })
})
