/**
 * A project folder of the disk behind a handle, where a browser shows a page no file or folder
 * with certain names (`hiddenByHandle`). A sample named like that may well be where its set
 * expects it: the page must not take another file for it, and must plan no copy to a name the
 * browser refuses to make, or every set of such a fix fails.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { liveCrc, REL_PROJECT } from '@livesaver/core'
import {
  copyFixtures,
  deviceSet,
  droppedFolder,
  MemoryDirectory,
  makeProject,
  memoryFiles,
  memoryFolder,
  tempDir,
  uploadedFolder,
  writeFile,
  writeSet,
} from '@livesaver/test-kit'
import {
  type BrowserScan,
  editable,
  type FixEvent,
  type FixRequest,
  type FolderInput,
  fixFolders,
  fixInWorker,
  folderFromHandle,
  hiddenByHandle,
  localEngineWorker,
  type ScanEvent,
  scanFolders,
  scanInWorker,
} from '../src/index.js'

const SET = 'Brokenpath Project/Brokenpath.als'
const SONG = 'Song Project/Song.als'
const OTHER = 'Other Project/Other.als'
/** A name a handle hides: it starts with a space. */
const LEAD = ' lead.wav'
const ODD = ' odd.wav'

let tmp: { path: string; cleanup: () => void }
let projects: string
let samples: string
/** The project folder as the page has it: chosen for editing, with the names a browser hides. */
let folder: MemoryDirectory
/** The page's own storage. */
let state: MemoryDirectory

const bytes = (text: string) => new TextEncoder().encode(text)
/**
 * A set with one sample. `relPath`: where it lies from the project folder; without it the
 * sample lies outside, as on a drive that is gone, and the set stores the way there as Live does.
 */
const sampleSet = (path: string, data: Uint8Array, relPath = '') =>
  deviceSet(
    path,
    data.length,
    liveCrc(data),
    relPath ? { relType: REL_PROJECT, relPath } : { relPath: `../../..${path}` },
  ).replaceAll('MxPatchRef', 'SampleRef')

/**
 * Beside the fixtures' project with a sample to find: a project whose sample is in it, under a
 * name the browser hides, and one that looks for a sample of such a name on a drive that is
 * gone. Both samples also lie in the sample folder, where the page sees them.
 */
beforeEach(() => {
  tmp = tempDir()
  ;({ projects, samples } = copyFixtures(tmp.path))
  const lead = bytes('RIFF lead of the song')
  const song = makeProject(projects, 'Song')
  writeFile(join(song, 'Samples', LEAD), lead)
  writeSet(join(song, 'Song.als'), sampleSet(`${song}/Samples/${LEAD}`, lead, `Samples/${LEAD}`))
  const gone = bytes('RIFF of a drive that is gone')
  const other = makeProject(projects, 'Other')
  writeSet(join(other, 'Other.als'), sampleSet(`/Volumes/Gone/Loops/${ODD}`, gone))
  writeFile(join(samples, 'Loops', LEAD), lead)
  writeFile(join(samples, 'Loops', ODD), gone)
  folder = memoryFolder(projects)
  folder.hides = hiddenByHandle
  state = new MemoryDirectory('')
})
afterEach(() => tmp.cleanup())

const request = (search?: FolderInput): FixRequest => ({
  projects: [{ id: 'p', source: folderFromHandle(folder), path: projects, vendor: false }],
  search: [search ?? { id: 's', source: uploadedFolder(samples), path: samples, vendor: false }],
  options: { packLimitMB: 50, matchLibraryPath: false },
})

/** The folder the project folder lies in, as an upload: it shows every name. */
const around = (): FolderInput => ({
  id: 'a',
  source: uploadedFolder(tmp.path),
  path: '',
  vendor: false,
})

async function scan(asked = request()): Promise<BrowserScan> {
  const events: ScanEvent[] = []
  await scanFolders(asked, (event) => events.push(event), { cores: 1 })
  const last = events.at(-1)
  if (last?.type !== 'scanned') throw new Error(JSON.stringify(last))
  return last.scan
}

/** Each sample a scan leaves missing, and what kept the page from it. */
const left = (found: BrowserScan) =>
  found.samples.missing.map((row) => [row.name, row.status, row.blind]).sort()
const setRow = (found: BrowserScan, path: string) =>
  found.samples.setRows.find((row) => row.path === path)
/** What a fix added to the project folder. */
const added = (before: ReadonlyMap<string, unknown>) =>
  [...memoryFiles(folder).keys()].filter((path) => !before.has(path) && !path.includes('/Backup/'))

describe('a project folder of the disk, where a browser hides files with some names', () => {
  test('the page sees neither the hidden sample nor a place to make one', async () => {
    const found = await scan()
    // The song's sample is where its set expects it. The page cannot see that, so it takes no
    // other file for it. The other set's sample is found, but its copy would get a name the
    // browser makes no file with.
    expect(left(found)).toEqual([
      [LEAD, 'not-found', 'unseen'],
      [ODD, 'not-found', 'unmade'],
    ])
    // What was found for the second is named, so that it can be put in place by hand.
    expect(found.samples.missing.map((row) => [row.name, row.candidates]).sort()).toEqual([
      [LEAD, []],
      [ODD, [join(samples, 'Loops', ODD)]],
    ])
    // Neither set is planned to change: only the fixtures' one is.
    expect([found.samples.changingSets, found.samples.copyFiles]).toEqual([1, 1])
    expect(found.samples.changes.map((change) => change.setPath)).toEqual([SET])
    expect([setRow(found, SONG)?.changes, setRow(found, OTHER)?.changes]).toEqual([0, 0])
  })

  test('a fix writes the sets it can, and fails for none', async () => {
    const before = memoryFiles(folder)
    const events: FixEvent[] = []
    await fixFolders(request(), (event) => events.push(event), {
      cores: 1,
      state: async () => state,
    })
    const last = events.at(-1)
    if (last?.type !== 'fixed') throw new Error(JSON.stringify(last))
    expect(last.fixed.errors).toEqual([])
    expect([last.fixed.sets, last.fixed.files]).toEqual([1, 1])
    const files = memoryFiles(folder)
    expect([SET, SONG, OTHER].map((path) => files.get(path)?.writes)).toEqual([1, 0, 0])
    // Nothing was copied for a set that is then not written.
    expect(added(before).sort()).toEqual([
      'Brokenpath Project/Samples/Imported/1.wav',
      'Brokenpath Project/Samples/Imported/1.wav.asd',
    ])
  })

  test('a folder given around the project folder shows what the handle hides', async () => {
    // A folder that was dropped or uploaded shows every name: here the folder the project
    // folder lies in.
    const found = await scan(request(around()))
    // (Nobody typed where it lies: it holds the project folder, which says so.)
    expect(found.folders).toEqual([
      { id: 'p', path: projects, how: 'typed' },
      { id: 'a', path: tmp.path, how: 'found' },
    ])
    // The song is complete, as it is on the disk. The other sample still cannot be copied in.
    expect(left(found)).toEqual([[ODD, 'not-found', 'unmade']])
    expect(setRow(found, SONG)).toMatchObject({
      changes: 0,
      counts: { ok: 1, 'not-found': 0 },
    })
    expect(found.samples.completeSets).toBe(found.samples.sets - 1)
  })

  test('the project folder itself, given once more as an upload, shows it too', async () => {
    // What one tries first: the same folder, dropped onto the sample folders.
    const again = { id: 'a', source: uploadedFolder(projects), path: '', vendor: false }
    const asked = request()
    const found = await scan({ ...asked, search: [...asked.search, again] })
    // It is the project folder: one place, read once.
    expect(found.folders.map((at) => [at.id, at.path, at.how])).toEqual([
      ['p', projects, 'typed'],
      ['s', samples, 'typed'],
      ['a', projects, 'found'],
    ])
    expect(left(found)).toEqual([[ODD, 'not-found', 'unmade']])
    expect(setRow(found, SONG)).toMatchObject({ changes: 0, counts: { ok: 1 } })
    expect(found.samples.indexedFiles).toBe((await scan()).samples.indexedFiles + 1)
  })

  test('dropped to be edited, the project folder is read in full from the start, and fixed', async () => {
    // A drop lists every file; the handle the browser gives with it is what writes. As the
    // page runs it: in a worker, which asks the page for the files the handle hides.
    const asked: FixRequest = {
      ...request(),
      projects: [
        { id: 'p', source: editable(droppedFolder(projects, folder)), path: '', vendor: false },
      ],
    }
    const reading = () => localEngineWorker({ cores: 1 })
    const found = await scanInWorker(reading, asked, () => {}).result
    expect(left(found)).toEqual([[ODD, 'not-found', 'unmade']])
    expect(setRow(found, SONG)).toMatchObject({ changes: 0, counts: { ok: 1 } })

    const before = memoryFiles(folder)
    const writing = () => localEngineWorker({ cores: 1, state: async () => state })
    const fixed = await fixInWorker(writing, asked, () => {})
    expect([fixed.errors, fixed.sets, fixed.files]).toEqual([[], 1, 1])
    expect(added(before).sort()).toEqual([
      'Brokenpath Project/Samples/Imported/1.wav',
      'Brokenpath Project/Samples/Imported/1.wav.asd',
    ])
  })

  test('a project in a folder with such a name is checked through the folder around, never fixed', async () => {
    // The browser shows the page nothing of this project: its folder starts with a space.
    const loop = bytes('RIFF a loop of a drive that is gone')
    const odd = makeProject(projects, ' Odd')
    writeSet(join(odd, 'Odd.als'), sampleSet('/Volumes/Gone/Loops/loop.wav', loop))
    writeFile(join(samples, 'Loops', 'loop.wav'), loop)
    folder = memoryFolder(projects)
    folder.hides = hiddenByHandle
    const hidden = ' Odd Project/Odd.als'
    expect((await scan()).samples.setRows.map((row) => row.path)).not.toContain(hidden)

    // The folder around it shows the project. The page reads its set, and can write nothing
    // there: the sample it found for it is named, and nothing is planned.
    const found = await scan(request(around()))
    expect(found.folders[1]).toEqual({ id: 'a', path: tmp.path, how: 'found' })
    expect(setRow(found, hidden)).toMatchObject({ changes: 0, counts: { 'not-found': 1 } })
    expect(found.samples.missing.find((row) => row.name === 'loop.wav')).toMatchObject({
      blind: 'locked',
      candidates: [join(samples, 'Loops', 'loop.wav')],
    })
    expect(found.samples.changes.map((change) => change.setPath)).toEqual([SET])

    const before = memoryFiles(folder)
    const events: FixEvent[] = []
    await fixFolders(request(around()), (event) => events.push(event), {
      cores: 1,
      state: async () => state,
    })
    const last = events.at(-1)
    if (last?.type !== 'fixed') throw new Error(JSON.stringify(last))
    expect([last.fixed.errors, last.fixed.sets, last.fixed.files]).toEqual([[], 1, 1])
    expect(added(before).sort()).toEqual([
      'Brokenpath Project/Samples/Imported/1.wav',
      'Brokenpath Project/Samples/Imported/1.wav.asd',
    ])
  })
})
