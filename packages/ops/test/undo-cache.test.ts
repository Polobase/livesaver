/** Undo of applied runs, and the complete-sets cache. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { EMPTY_REMAP } from '@livesaver/core'
import { createNodeHost } from '@livesaver/node'
import {
  copyFixtures,
  makeProject,
  sampleSet,
  tempDir,
  writeFile,
  writeSet,
} from '@livesaver/test-kit'
import {
  applyWriter,
  buildReports,
  CompleteSets,
  DEFAULT_PACK_LIMIT,
  doctor,
  type EnvConfig,
  type JournalEntry,
  Probe,
  type RunContext,
  readJournal,
  runSummary,
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

  test('leaves a set alone that changed after the run, and keeps the copies it uses', async () => {
    const run = await apply([project], [samples])
    // Someone saved the set again (here: with another name for its creator).
    const saved = gunzipSync(readFileSync(setPath)).toString().replace('Creator="', 'Creator="x ')
    writeFile(setPath, gzipSync(saved))
    const report = await undoRun(host(), run, ENV)
    expect(report.changedSince).toEqual([setPath])
    expect(report.restored).toEqual([])
    // (The fixture's project has no "Ableton Project Info": the set is found all the same.)
    const copy = join(project, 'Samples', 'Imported', '1.wav')
    expect([report.stillUsed, report.trashed]).toEqual([[copy], []])
    expect(existsSync(copy)).toBe(true)
    // The set is left alone for good; the copy can still go once nothing uses it.
    expect(await state(run)).toMatchObject({
      state: 'partly-undone',
      standing: { sets: 0, files: 1 },
    })
    rmSync(setPath)
    expect((await undoRun(host(), run, ENV)).trashed).toEqual([copy, `${copy}.asd`])
    expect(await state(run)).toMatchObject({ state: 'undone', canUndo: false })
  })

  test('keeps every copy of a project whose changed set cannot be read', async () => {
    const run = await apply([project], [samples])
    const broken = readFileSync(setPath)
    const last = broken.length - 1
    broken[last] = (broken[last] as number) ^ 1 // what it uses now, nobody can tell
    writeFile(setPath, broken)
    const report = await undoRun(host(), run, ENV)
    expect(report.changedSince).toEqual([setPath])
    expect([report.stillUsed.length, report.trashed]).toEqual([1, []])
  })

  test('takes back what was found taken back already, and says so', async () => {
    const original = readFileSync(setPath)
    const run = await apply([project], [samples])
    const { original: kept } = (await journal(run)).find(
      (e) => e.t === 'begin' && e.op === 'write-set',
    ) as Extract<JournalEntry, { op: 'write-set'; t: 'begin' }>
    // Restored and cleaned up by hand.
    copyFileSync(kept, setPath)
    rmSync(join(project, 'Samples', 'Imported', '1.wav'))
    const report = await undoRun(host(), run, ENV)
    expect([report.restored, report.alreadyRestored]).toEqual([[], [setPath]])
    expect(readFileSync(setPath)).toEqual(original)
    // The analysis file the run had copied beside the sample is of no use alone.
    expect(report.trashed).toEqual([join(project, 'Samples', 'Imported', '1.wav.asd')])
    expect(await state(run)).toMatchObject({ state: 'undone', canUndo: false })
  })
})

/** What the journal of a run says became of it. */
async function journal(run: RunContext): Promise<JournalEntry[]> {
  return readJournal(host(), run)
}
const state = async (run: RunContext) => runSummary(run.id, await journal(run))

describe('undo of a copy that lies where its set had expected the file', () => {
  let project: string
  let library: string
  let setPath: string
  let wanted: string
  let original: Buffer<ArrayBuffer>
  /** A set that points at `Samples/Imported/Kick.wav` of its project; the file lies elsewhere. */
  beforeEach(() => {
    project = makeProject(tmp.path, 'Song')
    library = join(tmp.path, 'Library')
    wanted = join(project, 'Samples', 'Imported', 'Kick.wav')
    writeFile(wanted, new Uint8Array(4000).fill(7))
    setPath = writeSet(join(project, 'Song.als'), sampleSet(project, ['Kick.wav']))
    mkdirSync(library, { recursive: true })
    renameSync(wanted, join(library, 'Kick.wav'))
    original = readFileSync(setPath)
  })

  test('it is taken back with the set: the set only ever expected it', async () => {
    const run = await apply([project], [library])
    expect(existsSync(wanted)).toBe(true)
    const report = await undoRun(host(), run, ENV)
    expect([report.restored, report.trashed, report.stillUsed]).toEqual([[setPath], [wanted], []])
    expect(readFileSync(setPath)).toEqual(original)
    expect(existsSync(wanted)).toBe(false)
    expect(await state(run)).toMatchObject({ state: 'undone', canUndo: false })
  })

  test('an undo that stopped at it before finishes now', async () => {
    // As an undo of an older livesaver left it: the set restored and noted, the copy standing.
    const run = await apply([project], [library])
    const written = (await journal(run)).find((e) => e.t === 'begin' && e.op === 'write-set')
    const kept = (written as Extract<JournalEntry, { op: 'write-set'; t: 'begin' }>).original
    copyFileSync(kept, setPath)
    appendFileSync(
      join(run.dir, 'journal.jsonl'),
      `${JSON.stringify({ t: 'undo', id: written?.id, result: 'restored' })}\n`,
    )
    expect(await state(run)).toMatchObject({
      state: 'partly-undone',
      standing: { sets: 0, files: 1 },
    })
    const report = await undoRun(host(), run, ENV)
    expect([report.trashed, report.stillUsed]).toEqual([[wanted], []])
    expect(await state(run)).toMatchObject({ state: 'undone', canUndo: false })
  })

  test('a set that was made since and uses it keeps it', async () => {
    const run = await apply([project], [library])
    // Saved in Live after the fix, under a new name: it points at the file that is there now.
    const later = writeSet(join(project, 'Song later.als'), sampleSet(project, ['Kick.wav']))
    const report = await undoRun(host(), run, ENV)
    expect([report.restored, report.trashed, report.stillUsed]).toEqual([[setPath], [], [wanted]])
    expect(existsSync(wanted)).toBe(true)
    expect(await state(run)).toMatchObject({ state: 'partly-undone', canUndo: true })
    // Once that set is gone, the undo takes the copy as well.
    rmSync(later)
    expect((await undoRun(host(), run, ENV)).trashed).toEqual([wanted])
    expect(await state(run)).toMatchObject({ state: 'undone' })
  })

  test('two fixes, undone newest first: everything is as it was', async () => {
    const first = await apply([project], [library])
    // A second sample turns up in the library later, and is fixed by a second run.
    const second = join(project, 'Samples', 'Imported', 'Snare.wav')
    writeFile(second, new Uint8Array(3000).fill(9))
    const both = sampleSet(project, ['Kick.wav', 'Snare.wav'])
    renameSync(second, join(library, 'Snare.wav'))
    // (The set as Live would have saved it with the second sample, before the second fix.)
    writeSet(setPath, both)
    const between = readFileSync(setPath)
    const run = await apply([project], [library])
    expect((await undoRun(host(), run, ENV)).trashed).toEqual([second])
    expect(readFileSync(setPath)).toEqual(between)
    // The first run's set was saved again since: left alone, and its copy with it.
    const report = await undoRun(host(), first, ENV)
    expect([report.changedSince, report.stillUsed, report.trashed]).toEqual([
      [setPath],
      [wanted],
      [],
    ])
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
