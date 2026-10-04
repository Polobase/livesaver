/**
 * A fix in the browser: through folders in memory that behave like a browser's handles, it
 * writes what the command line's pipeline writes, keeps the run in the page's own storage, and
 * takes it back.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { EMPTY_REMAP } from '@livesaver/core'
import { createNodeHost } from '@livesaver/node'
import { applyWriter, type DoctorResult, doctor, type EnvConfig, Probe } from '@livesaver/ops'
import {
  copyFixtures,
  fileRefBodies,
  MemoryDirectory,
  type MemoryFile,
  memoryFiles,
  memoryFolder,
  readSet,
  stripSampleRefs,
  tempDir,
  uploadedFolder,
} from '@livesaver/test-kit'
import {
  type BrowserFixed,
  type BrowserUndone,
  browserReport,
  browserRun,
  browserRuns,
  EngineFailure,
  type FixEvent,
  type FixRequest,
  fixFolders,
  fixInWorker,
  folderFromHandle,
  localEngineWorker,
  TRASH_FOLDER,
  type UndoEvent,
  undoFolders,
  undoInWorker,
  type WriteEngineOptions,
} from '../src/index.js'

const ENV: EnvConfig = {
  userLibrary: '',
  factoryPacks: '',
  appResources: '',
  preferredRoots: [],
  vendorLibraries: [],
  remap: EMPTY_REMAP,
}
const SET = 'Brokenpath Project/Brokenpath.als'
const COPY = 'Brokenpath Project/Samples/Imported/1.wav'

let tmp: { path: string; cleanup: () => void }
let projects: string
let samples: string
/** The project folder as the page has it: chosen for editing. */
let folder: MemoryDirectory
/** The page's own storage. */
let state: MemoryDirectory
beforeEach(() => {
  tmp = tempDir()
  ;({ projects, samples } = copyFixtures(tmp.path))
  folder = memoryFolder(projects)
  state = new MemoryDirectory('')
})
afterEach(() => tmp.cleanup())

const request = (more: Partial<FixRequest> = {}): FixRequest => ({
  projects: [{ id: 'p', source: folderFromHandle(folder), path: projects, vendor: false }],
  search: [{ id: 's', source: uploadedFolder(samples), path: samples, vendor: false }],
  options: { packLimitMB: 50, matchLibraryPath: false },
  ...more,
})
const options = (more: Partial<WriteEngineOptions> = {}): WriteEngineOptions => ({
  cores: 1,
  state: async () => state,
  ...more,
})

async function fix(asked = request(), how = options()) {
  const events: FixEvent[] = []
  await fixFolders(asked, (event) => events.push(event), how)
  const last = events.at(-1) as FixEvent
  return {
    events,
    fixed: last.type === 'fixed' ? last.fixed : undefined,
    failed: last.type === 'failed' ? last : undefined,
  }
}

async function undo(run: string, asked = request(), how = options()) {
  const events: UndoEvent[] = []
  await undoFolders({ ...asked, run }, (event) => events.push(event), how)
  const last = events.at(-1) as UndoEvent
  return {
    undone: last.type === 'undone' ? last.undone : undefined,
    failed: last.type === 'failed' ? last.message : '',
  }
}

/** The pipeline of `livesaver collect --apply` on the folders on disk. */
async function commandLine(): Promise<DoctorResult> {
  const host = createNodeHost({ write: true, trashDir: join(tmp.path, 'trash'), finder: false })
  const probe = new Probe(host.fs, host.hash)
  const run = { id: 'run', dir: join(tmp.path, 'run') }
  return doctor(host, {
    targets: [projects],
    searchRoots: [projects, samples],
    env: ENV,
    packCopyLimit: 50_000_000,
    probe,
    writer: applyWriter(host, run, probe),
  })
}

const xmlOf = (file: MemoryFile | undefined) =>
  new TextDecoder().decode(gunzipSync(file?.data ?? new Uint8Array(0)))
const stored = (path: string) => memoryFiles(state).get(path)
const runIds = () => {
  const runs = state.entries.get('runs')
  return runs instanceof MemoryDirectory ? [...runs.entries.keys()] : []
}
/** Backups are named by the second they were made in. */
const unstamped = (path: string) => path.replace(/\[\d{4}-\d\d-\d\d \d{6}\]/, '[when]')

describe('a fix through folder handles', () => {
  test('writes what the command line writes', async () => {
    const original = readFileSync(join(projects, SET))
    const { fixed, events } = await fix()
    const expected = await commandLine()

    expect(fixed?.sets).toBe(expected.results.filter((set) => set.written).length)
    expect(fixed?.sets).toBe(1)
    expect(fixed?.files).toBe(expected.projects.reduce((n, p) => n + p.copiedFiles, 0))
    expect(fixed?.bytes).toBe(expected.projects.reduce((n, p) => n + p.copiedBytes, 0))
    expect(fixed?.errors).toEqual([])
    expect(
      events.filter((e) => e.type === 'phase').map((e) => e.type === 'phase' && e.phase),
    ).toEqual(['locating', 'indexing', 'fixing', 'reporting'])
    expect(events.filter((e) => e.type === 'progress').length).toBe(expected.results.length)

    // The set points where the command line's points, and nothing else in it changed.
    const mine = xmlOf(memoryFiles(folder).get(SET))
    const theirs = readSet(join(projects, SET))
    expect(fileRefBodies(mine)).toEqual(fileRefBodies(theirs))
    expect(stripSampleRefs(mine)).toBe(stripSampleRefs(theirs))
    expect(mine).toContain('Samples/Imported/1.wav')

    // The same files in the same places, with the same content; the set is gzipped by the
    // browser, so it is compared as XML (above).
    const disk = (dir: string, prefix = ''): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? disk(join(dir, entry.name), `${prefix}${entry.name}/`)
          : [prefix + entry.name],
      )
    const files = memoryFiles(folder)
    expect([...files.keys()].map(unstamped).sort()).toEqual(disk(projects).map(unstamped).sort())
    for (const [path, file] of files) {
      if (path === SET || path.includes('/Backup/')) continue
      expect([path, Buffer.from(file.data).equals(readFileSync(join(projects, path)))]).toEqual([
        path,
        true,
      ])
    }
    // The backup is the set as it was, in the project, as Live names its own.
    const backup = [...files].find(([path]) =>
      /^Brokenpath Project\/Backup\/Brokenpath \[\d{4}-\d\d-\d\d \d{6}\]\.als$/.test(path),
    )
    expect(Buffer.from(backup?.[1].data ?? []).equals(original)).toBe(true)
    // Written once each: the set, and the copy.
    expect(files.get(SET)?.writes).toBe(1)
    expect(files.get(COPY)?.writes).toBe(1)
  })

  test('a copy has the time of the copying, and the set says so', async () => {
    const before = Date.now()
    await fix()
    const copied = memoryFiles(folder).get(COPY) as MemoryFile
    expect(copied.modified).toBeGreaterThanOrEqual(before)
    const stamps = [...xmlOf(memoryFiles(folder).get(SET)).matchAll(/<LastModDate Value="(\d+)"/g)]
    expect(stamps.map((m) => Number(m[1]))).toContain(Math.floor(copied.modified / 1000))
  })

  test('keeps the run in the page’s own storage: journal, originals, reports, and what was asked', async () => {
    const original = readFileSync(join(projects, SET))
    const { fixed } = await fix()
    const id = fixed?.run as string
    expect(id).toMatch(/^\d{4}-\d\d-\d\d_\d{6}_collect_apply$/)
    expect(runIds()).toEqual([id])
    const kept = [...memoryFiles(state).keys()].filter((path) => path.startsWith(`runs/${id}/`))
    expect(kept).toContain(`runs/${id}/journal.jsonl`)
    expect(kept).toContain(`runs/${id}/run.json`)
    const originals = kept.filter((path) => path.includes('/originals/'))
    expect(originals.length).toBe(1)
    expect(Buffer.from(stored(originals[0] as string)?.data ?? []).equals(original)).toBe(true)

    const [run, ...others] = await browserRuns(async () => state)
    expect(others).toEqual([])
    expect(run).toMatchObject({
      id,
      command: 'collect',
      applied: true,
      state: 'applied',
      sets: 1,
      files: 1,
      canUndo: true,
      unfinished: 0,
    })
    expect(run?.record?.targets).toEqual([projects])
    expect(run?.record?.options).toMatchObject({ search: [projects, samples], certainOnly: false })
    expect(run?.record?.outcome).toMatchObject({ sets: 3, written: 1, files: 1, errors: 0 })
    expect(run?.record?.ended).toBeDefined()
    expect(run?.reports.length).toBeGreaterThan(0)
    expect(run?.reports.every((name) => /\.(csv|md)$/.test(name))).toBe(true)

    const detail = await browserRun(async () => state, id)
    expect(detail.steps.map((step) => [step.op, step.finished, step.undone])).toEqual([
      ['copy', true, ''],
      ['write-set', true, ''],
    ])
    expect(detail.steps[1]?.path).toBe(join(projects, SET))
    const report = await browserReport(async () => state, id, run?.reports[0] as string)
    expect(report.length).toBeGreaterThan(0)
    expect(browserReport(async () => state, id, 'journal.jsonl')).rejects.toThrow(
      'The run has no such report',
    )
    expect(browserRun(async () => state, '../elsewhere')).rejects.toThrow('There is no such run')
  })

  test('an undo puts the set back byte for byte and takes the copy out of the project', async () => {
    const original = readFileSync(join(projects, SET))
    const { fixed } = await fix()
    const id = fixed?.run as string
    const { undone } = await undo(id)
    expect(undone).toEqual({
      restored: 1,
      // The sample, and the analysis file Live keeps beside it.
      trashed: 2,
      kept: 0,
      changedSince: [],
      problems: [],
    } satisfies BrowserUndone)

    const files = memoryFiles(folder)
    expect(Buffer.from(files.get(SET)?.data ?? []).equals(original)).toBe(true)
    expect(files.has(COPY)).toBe(false)
    // Nothing is deleted: the copy lies in a hidden folder of the folder it was in.
    const trashed = [...files.keys()].filter((path) => path.startsWith(`${TRASH_FOLDER}/`))
    expect(trashed.map((path) => path.split('/').slice(2).join('/'))).toEqual([COPY, `${COPY}.asd`])
    // The backup stays, as after an undo on the command line.
    expect([...files.keys()].some((path) => path.startsWith('Brokenpath Project/Backup/'))).toBe(
      true,
    )

    const [run] = await browserRuns(async () => state)
    expect(run).toMatchObject({ state: 'undone', canUndo: false })
    // What an undo took out, a scan does not take for a sample; a second undo finds nothing.
    expect((await undo(id)).undone).toMatchObject({ restored: 0, trashed: 0 })
    // A fix after the undo does the same again.
    expect((await fix()).fixed).toMatchObject({ sets: 1, files: 1 })
  })

  test('fixes only the projects that were asked for, with every folder to choose from', async () => {
    const root = join(projects, 'Brokenpath Project')
    const { fixed } = await fix(request({ only: [root] }))
    expect(fixed).toMatchObject({ sets: 1, files: 1, errors: [] })
    const [run] = await browserRuns(async () => state)
    expect(run?.record?.targets).toEqual([root])
    expect(run?.record?.outcome).toMatchObject({ sets: 1 })

    expect((await fix(request({ only: ['/elsewhere/Song Project'] }))).failed?.message).toBe(
      'This folder is not in a project folder that was scanned: /elsewhere/Song Project',
    )
    expect((await fix(request({ only: [join(projects, 'Gone Project')] }))).failed?.message).toBe(
      `This folder does not exist: ${join(projects, 'Gone Project')}`,
    )
  })

  test('goes through the engine’s worker, as a page asks for it', async () => {
    const spawn = () => localEngineWorker(options())
    const events: FixEvent[] = []
    const fixed: BrowserFixed = await fixInWorker(spawn, request(), (event) => events.push(event))
    expect(fixed).toMatchObject({ sets: 1, files: 1 })
    expect(events.some((event) => event.type === 'progress')).toBe(true)
    expect(events.at(-1)?.type).toBe('fixed')
    expect(await undoInWorker(spawn, { ...request(), run: fixed.run })).toMatchObject({
      restored: 1,
      trashed: 2,
    })
    expect(undoInWorker(spawn, { ...request(), run: 'no-such-run' })).rejects.toThrow(
      'This is not a run that changed anything: no-such-run',
    )
    // An engine that was given no storage of its own only reads.
    const reading = () => localEngineWorker({ cores: 1 })
    const refused = fixInWorker(reading, request(), () => {})
    expect(refused).rejects.toBeInstanceOf(EngineFailure)
    expect(refused).rejects.toThrow('This page has no storage of its own to keep an undo in.')
  })
})

describe('a fix is refused', () => {
  const untouched = () => {
    expect(runIds()).toEqual([])
    expect([...memoryFiles(folder).values()].every((file) => file.writes === 0)).toBe(true)
  }

  test('when a project folder was not given for editing', async () => {
    const asked = request({
      projects: [{ id: 'p', source: uploadedFolder(projects), path: projects, vendor: false }],
    })
    expect((await fix(asked)).failed?.message).toBe(
      'The project folder “projects” was not given for editing: choose it again, and allow this page to edit it.',
    )
    expect((await fix(request({ projects: [] }))).failed?.message).toBe(
      'No project folder was given.',
    )
    untouched()
  })

  test('when it is not known where a project folder lies: a stand-in path must not get into a set', async () => {
    // The same place twice: the second folder cannot lie there too, and has no place then.
    const twice = request({
      projects: [
        { id: 'p', source: folderFromHandle(folder), path: projects, vendor: false },
        {
          id: 'q',
          source: folderFromHandle(memoryFolder(projects)),
          path: projects,
          vendor: false,
        },
      ],
    })
    const { failed } = await fix(twice)
    expect(failed?.message).toStartWith(
      'livesaver does not know where “projects” lies on your disk, and a fix writes into the sets where their files are.',
    )
    expect(failed?.run).toBeUndefined()
    untouched()
  })

  test('but not for a sample folder without a place: its files are copied, and nothing points at it', async () => {
    const asked = request({
      search: [{ id: 's', source: uploadedFolder(samples), path: '', vendor: false }],
    })
    const { fixed } = await fix(asked)
    expect(fixed).toMatchObject({ sets: 1, files: 1, errors: [] })
    expect(xmlOf(memoryFiles(folder).get(SET))).not.toContain('"/samples/')
  })

  test('while another tab of the page writes', async () => {
    const { failed } = await fix(
      request(),
      options({
        exclusive: async () => {
          throw new Error('Another tab of this page is fixing or undoing right now.')
        },
      }),
    )
    expect(failed).toEqual({
      type: 'failed',
      message: 'Another tab of this page is fixing or undoing right now.',
    })
    untouched()
    // With the way free, the work runs inside the lock.
    const order: string[] = []
    const { fixed } = await fix(
      request(),
      options({
        exclusive: async (work) => {
          order.push('locked')
          await work()
          order.push('released')
        },
      }),
    )
    expect(fixed?.sets).toBe(1)
    expect(order).toEqual(['locked', 'released'])
  })
})

describe('what can go wrong while a fix runs', () => {
  test('a set that was saved after it was read is not written', async () => {
    const set = memoryFiles(folder).get(SET) as MemoryFile
    let fetched = 0
    // Live saves the set after livesaver has read it: the file is a newer one from then on.
    set.getFile = async () =>
      new File([set.data as Uint8Array<ArrayBuffer>], set.name, {
        lastModified: set.modified + (fetched++ ? 5000 : 0),
      })
    const { fixed } = await fix()
    expect(fixed?.sets).toBe(0)
    expect(fixed?.errors).toEqual([
      {
        set: join(projects, SET),
        error: 'the set changed after it was read (is Live saving it?); not written',
      },
    ])
    expect(set.writes).toBe(0)
    expect(
      [...memoryFiles(folder).keys()].some((path) => path.includes('Brokenpath Project/Backup/')),
    ).toBe(false)
    // The copy that was made for it is in the journal, and an undo takes it out again.
    const { undone } = await undo(fixed?.run as string)
    expect(undone).toMatchObject({ restored: 0, trashed: 2 })
  })

  test('a name the browser does not allow fails for its set, and the set stays as it was', async () => {
    const imported = await (
      await folder.getDirectoryHandle('Brokenpath Project')
    ).getDirectoryHandle('Samples', { create: true })
    // A browser refuses to make some names (here: any file in this folder).
    const refusing = await imported.getDirectoryHandle('Imported', { create: true })
    refusing.getFileHandle = async (name) => {
      throw new TypeError(`Name is not allowed: ${name}`)
    }
    const { fixed } = await fix()
    expect(fixed?.sets).toBe(0)
    expect(fixed?.errors.map((error) => error.error)).toEqual([
      'The browser lets a page make no file or folder named “1.wav”.',
    ])
    expect(memoryFiles(folder).get(SET)?.writes).toBe(0)
    // A copy that was not made is not counted as one.
    expect([fixed?.files, fixed?.bytes]).toEqual([0, 0])
  })

  test('a run that fails after it wrote names itself, so that it can be undone', async () => {
    const original = readFileSync(join(projects, SET))
    // The page's storage is full by the time the reports are written.
    const full = (dir: MemoryDirectory): MemoryDirectory =>
      new Proxy(dir, {
        get(target, key) {
          if (key === 'getDirectoryHandle')
            return async (name: string, how?: { create?: boolean }) =>
              full(await target.getDirectoryHandle(name, how))
          if (key === 'getFileHandle')
            return async (name: string, how?: { create?: boolean }) => {
              if (/\.(csv|md)$/.test(name))
                throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
              return target.getFileHandle(name, how)
            }
          const value = Reflect.get(target, key, target)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    const how = options({ state: async () => full(state) })
    const { failed } = await fix(request(), how)
    expect(failed?.message).toBe('The quota has been exceeded.')
    const id = failed?.run as string
    expect(id).toMatch(/_collect_apply$/)
    expect(memoryFiles(folder).get(SET)?.writes).toBe(1)
    const [run] = await browserRuns(async () => state)
    expect(run).toMatchObject({ id, state: 'applied', sets: 1, files: 1 })
    expect(run?.record?.error).toBe('The quota has been exceeded.')

    expect((await undo(id)).undone).toMatchObject({ restored: 1, trashed: 2 })
    expect(Buffer.from(memoryFiles(folder).get(SET)?.data ?? []).equals(original)).toBe(true)
  })
})

describe('an undo is refused', () => {
  test('when the folder the run changed is not among the folders the page has', async () => {
    const { fixed } = await fix()
    const set = memoryFiles(folder).get(SET) as MemoryFile
    const elsewhere = request({
      projects: [
        { id: 'p', source: folderFromHandle(folder), path: '/other/place', vendor: false },
      ],
    })
    const { failed } = await undo(fixed?.run as string, elsewhere)
    expect(failed).toBe(
      `This run changed ${join(projects, COPY)}, which is not in a project folder this page has now (/other/place). Give it the folder that was fixed, with the same path, and undo again.`,
    )
    expect(set.writes).toBe(1)
    expect((await browserRuns(async () => state))[0]?.state).toBe('applied')
  })

  test('for a set that was changed since: it is left alone, and said', async () => {
    const { fixed } = await fix()
    const set = memoryFiles(folder).get(SET) as MemoryFile
    set.data = new Uint8Array([...set.data, 0])
    const { undone } = await undo(fixed?.run as string)
    expect(undone?.restored).toBe(0)
    expect(undone?.changedSince).toEqual([join(projects, SET)])
    // The copy is still used by the set as it is now… as far as it can be read: it stays.
    expect(memoryFiles(folder).get(SET)?.writes).toBe(1)
  })
})
