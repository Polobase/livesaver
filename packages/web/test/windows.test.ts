/**
 * A page on Windows. The folders it is handed lie on drives, and the sets store paths with
 * drives: `C:/Users/…` as Live 11 and later write them, `C:\Users\…` as Live 9 and 10 did. A
 * page there places its folders by such paths, finds Live's own content where Windows has it,
 * and a fix writes paths as Live does.
 *
 * (No Windows is at hand: the page is told that it runs on one. Where Live's own folders lie
 * on Windows is as Ableton documents it.)
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { CORE_LIBRARY_PACK_ID, liveCrc, REL_NONE, REL_PACK, REL_PROJECT } from '@livesaver/core'
import {
  deviceSet,
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
  type FixEvent,
  type FixRequest,
  fixFolders,
  folderFromHandle,
  leadsTo,
  liveFolderPath,
  liveLandmark,
  locateFolder,
  type ScanEvent,
  scanFolders,
} from '../src/index.js'

const MUSIC = 'C:/Users/me/Music/Projects'
const LIVE = 'C:/ProgramData/Ableton/Live 12 Suite'

describe('where a folder lies, by paths with drives', () => {
  const anchors = [
    { savedAt: `${MUSIC}/Song Project`, inside: 'Song Project' },
    // A set of Live 10, saved there: the same place, with backslashes.
    { savedAt: 'C:\\Users\\me\\Music\\Projects\\Old Project', inside: 'Old Project' },
    // A set that came from a Mac says nothing about a disk of Windows.
    { savedAt: '/Users/me/Music/Projects/Mac Project', inside: 'Mac Project' },
  ]

  test('on Windows the sets that were saved on a drive say it; on a Mac the others', () => {
    expect(locateFolder('Projects', anchors, true)).toEqual({ path: MUSIC, votes: 2, of: 2 })
    expect(locateFolder('Projects', anchors)).toEqual({
      path: '/Users/me/Music/Projects',
      votes: 1,
      of: 1,
    })
  })

  test('Live’s own folder is the one in ProgramData, with Resources in it', () => {
    // Any path into it will do, typed as Windows shows it.
    const typed = 'C:\\ProgramData\\Ableton\\Live 12 Suite\\Resources\\Core Library'
    expect(liveFolderPath(typed, 'contents', true)).toBe(LIVE)
    expect(liveFolderPath(typed, 'resources', true)).toBe(`${LIVE}/Resources`)
    expect(liveFolderPath(typed, 'core', true)).toBe(`${LIVE}/Resources/Core Library`)
    expect(liveFolderPath('D:/Elsewhere/Core Library', 'core', true)).toBe(
      'D:/Elsewhere/Core Library',
    )
    // The sets say where it lies: a path into the Core Library leads to the folder given.
    const stored = [{ path: `${LIVE}/Resources/Core Library/Samples/x.wav`, version: 12_000_000 }]
    expect(leadsTo('Resources', [liveLandmark('resources', true)], stored, true)).toEqual([
      { path: `${LIVE}/Resources`, inside: 'Core Library/Samples/x.wav', version: 12_000_000 },
    ])
    expect(leadsTo('Live 12 Suite', [liveLandmark('contents', true)], stored, true)).toEqual([
      { path: LIVE, inside: 'Resources/Core Library/Samples/x.wav', version: 12_000_000 },
    ])
    // A path of a Mac is no lead there, and a path of Windows none on a Mac.
    expect(leadsTo('Resources', [liveLandmark('resources', true)], stored)).toEqual([])
  })
})

describe('a scan and a fix in a page on Windows', () => {
  let tmp: { path: string; cleanup: () => void }
  let projects: string
  let samples: string
  let resources: string
  let folder: MemoryDirectory
  const bytes = (text: string) => new TextEncoder().encode(text)
  const own = bytes('RIFF a sample of the song')
  const loop = bytes('RIFF a loop on the sample drive')
  const sampleSet = (path: string, data: Uint8Array, more: object) =>
    deviceSet(path, data.length, liveCrc(data), more).replaceAll('MxPatchRef', 'SampleRef')

  /**
   * As a disk of Windows has it: the projects in the user's Music folder, samples on a drive of
   * their own, and Live's resources in ProgramData. The sets name them by these paths.
   */
  beforeEach(() => {
    tmp = tempDir()
    projects = join(tmp.path, 'Projects')
    samples = join(tmp.path, 'Samples')
    resources = join(tmp.path, 'Resources')
    const song = makeProject(projects, 'Song')
    writeFile(join(song, 'Samples', 'own.wav'), own)
    writeSet(
      join(song, 'Song.als'),
      sampleSet(`${MUSIC}/Song Project/Samples/own.wav`, own, {
        relType: REL_PROJECT,
        relPath: 'Samples/own.wav',
      }),
    )
    // A sample on drive D, named by its path there: outside the project, to be collected.
    // (Beside the path, as the references with a drive of a real library have it: no kind of
    // relative path, and the file's name alone.)
    writeFile(join(samples, 'Loops', 'loop.wav'), loop)
    writeSet(
      join(song, 'Song 2.als'),
      sampleSet('D:/Samples/Loops/loop.wav', loop, { relType: REL_NONE, relPath: 'loop.wav' }),
    )
    // A sample of Live's Core Library.
    writeFile(join(resources, 'Core Library', 'Samples', 'x.wav'), 'RIFF')
    writeSet(
      join(song, 'Song 3.als'),
      sampleSet(`${LIVE}/Resources/Core Library/Samples/x.wav`, bytes('RIFF'), {
        relType: REL_PACK,
        relPath: 'Samples/x.wav',
        packName: 'Core Library',
        packId: CORE_LIBRARY_PACK_ID,
      }),
    )
    folder = memoryFolder(projects)
  })
  afterEach(() => tmp.cleanup())

  const request = (): FixRequest => ({
    projects: [{ id: 'p', source: folderFromHandle(folder), path: '', vendor: false }],
    search: [
      // Where the sample drive lies is typed, as Windows shows a path.
      { id: 's', source: uploadedFolder(samples), path: 'D:\\Samples', vendor: false },
      { id: 'r', source: uploadedFolder(resources), path: '', vendor: false },
    ],
    // (No file of a pack is copied: what is Live's own stays where it is, and shows as such.)
    options: { packLimitMB: 0, matchLibraryPath: false },
  })

  test('the folders are placed on their drives, and every sample is found where its set says', async () => {
    const events: ScanEvent[] = []
    await scanFolders(request(), (event) => events.push(event), { cores: 1, windows: true })
    const last = events.at(-1)
    if (last?.type !== 'scanned') throw new Error(JSON.stringify(last))
    expect(last.scan.folders).toEqual([
      { id: 'p', path: MUSIC, how: 'found' },
      { id: 's', path: 'D:/Samples', how: 'typed' },
      { id: 'r', path: `${LIVE}/Resources`, how: 'found' },
    ])
    const { samples: found } = last.scan
    // In the project, outside it (to be collected), and in Live's Core Library: none missing.
    expect(found.counts).toMatchObject({ ok: 1, external: 1, kept: 1, 'not-found': 0 })
    expect(found.changes.map((c) => [c.set, c.action, c.source, c.newPath])).toEqual([
      ['Song 2.als', 'collected', 'D:/Samples/Loops/loop.wav', 'Samples/Imported/loop.wav'],
    ])
    expect(last.scan.ableton.coreLibrary).toBe(`${LIVE}/Resources/Core Library`)
  })

  test('told that it runs on a Mac, the same page knows no place for these folders', async () => {
    const events: ScanEvent[] = []
    await scanFolders(request(), (event) => events.push(event), { cores: 1, windows: false })
    const last = events.at(-1)
    if (last?.type !== 'scanned') throw new Error(JSON.stringify(last))
    expect(last.scan.folders.map((at) => [at.id, at.how])).toEqual([
      ['p', 'unknown'],
      ['s', 'typed'],
      ['r', 'unknown'],
    ])
  })

  test('a fix writes the path into the set as Live does on Windows', async () => {
    const events: FixEvent[] = []
    await fixFolders(request(), (event) => events.push(event), {
      cores: 1,
      windows: true,
      state: async () => new MemoryDirectory(''),
    })
    const last = events.at(-1)
    if (last?.type !== 'fixed') throw new Error(JSON.stringify(last))
    expect([last.fixed.sets, last.fixed.files, last.fixed.errors]).toEqual([1, 1, []])
    const files = memoryFiles(folder)
    expect(files.has('Song Project/Samples/Imported/loop.wav')).toBe(true)
    const xml = new TextDecoder().decode(
      gunzipSync(files.get('Song Project/Song 2.als')?.data ?? new Uint8Array(0)),
    )
    expect(xml).toContain('<RelativePathType Value="3" />')
    expect(xml).toContain('<RelativePath Value="Samples/Imported/loop.wav" />')
    expect(xml).toContain(`<Path Value="${MUSIC}/Song Project/Samples/Imported/loop.wav" />`)
  })
})
