/** The folders a page was given, read like a file system. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createNodeHost } from '@livesaver/node'
import { Probe } from '@livesaver/ops'
import {
  copyFixtures,
  droppedFolder,
  memoryFolder,
  pickedFolder as picked,
  tempDir,
  uploadedFolder as uploaded,
  writeFile,
} from '@livesaver/test-kit'
import {
  editable,
  type FolderSource,
  folderFromHandle,
  foldersFromFiles,
  hiddenByHandle,
  WebFs,
  webCodec,
  webHash,
} from '../src/index.js'

let tmp: { path: string; cleanup: () => void }
let samples: string
beforeEach(() => {
  tmp = tempDir()
  samples = copyFixtures(tmp.path).samples
})
afterEach(() => tmp.cleanup())

/** An uploaded folder as a worker gets it: what it holds, and the files on request. */
function listed(dir: string): FolderSource {
  const { name, files } = uploaded(dir)
  return {
    kind: 'listing',
    name,
    paths: files.map((f) => f.path),
    open: async (i) => files[i]?.file,
  }
}

const kinds: [string, (dir: string) => FolderSource][] = [
  ['a picked folder (handles)', picked],
  ['an uploaded folder (files)', uploaded],
  ['a listed folder (files on request)', listed],
]

for (const [title, source] of kinds) {
  describe(title, () => {
    const mounted = () =>
      new WebFs([{ path: '/Users/someone/Music/samples', source: source(samples) }])

    test('lists folders and files', async () => {
      const fs = mounted()
      const names = async (path: string) =>
        (await fs.listDir(path))?.map((e) => `${e.name}${e.isDirectory ? '/' : ''}`).sort()
      expect(await names('/Users/someone/Music/samples')).toEqual(['Lib1/', 'Lib2/'])
      expect(await names('/Users/someone/Music/samples/Lib1/Kick')).toEqual(
        readdirSync(join(samples, 'Lib1', 'Kick')).sort(),
      )
      expect(await fs.listDir('/Users/someone/Music/samples/nothing')).toBeUndefined()
      expect(await fs.listDir('/Users/someone/Music/samples/Lib1/Kick/1.wav')).toBeUndefined()
    })

    test('stat and read like the file on disk', async () => {
      const fs = mounted()
      const real = join(samples, 'Lib1', 'Kick', '1.wav')
      const path = '/Users/someone/Music/samples/Lib1/Kick/1.wav'
      const stat = await fs.stat(path)
      expect([stat?.isFile, stat?.isDirectory, stat?.size]).toEqual([true, false, 2000324])
      expect(stat?.mtimeSec).toBe(Math.floor(statSync(real).mtimeMs / 1000))
      expect((await fs.stat('/Users/someone/Music/samples/Lib1'))?.isDirectory).toBe(true)
      expect(await fs.stat('/Users/someone/Music/samples/Lib1/Kick/2.wav')).toBeUndefined()
      const bytes = readFileSync(real)
      expect(Buffer.from(await fs.read(path, 0, 16384))).toEqual(bytes.subarray(0, 16384))
      expect(Buffer.from(await fs.read(path, 2000320, 100))).toEqual(bytes.subarray(2000320))
      expect(Buffer.from(await fs.readFile(path))).toEqual(bytes)
      expect(fs.readFile('/Users/someone/Music/samples/missing.wav')).rejects.toThrow(
        'No such file or directory',
      )
    })

    test('names compare like macOS: case and normalization do not matter', async () => {
      writeFile(join(samples, 'Café', 'Kick.wav'), 'RIFF')
      const fs = mounted()
      expect((await fs.stat('/users/SOMEONE/music/SAMPLES/lib1/KICK/1.WAV'))?.size).toBe(2000324)
      expect((await fs.stat('/Users/someone/Music/samples/Café/kick.wav'))?.isFile).toBe(true)
    })

    test('folders above a mount exist, and a mount inside another one wins', async () => {
      const inner = join(tmp.path, 'other')
      writeFile(join(inner, 'a.wav'), 'inner')
      const fs = new WebFs([
        { path: '/Users/someone/Music/samples', source: source(samples) },
        { path: '/Users/someone/Music/samples/Lib1/Kick', source: source(inner) },
        { path: '/Volumes/Disk', source: source(inner) },
      ])
      const names = async (path: string) => (await fs.listDir(path))?.map((e) => e.name).sort()
      expect(await names('/')).toEqual(['Users', 'Volumes'])
      expect(await names('/Users/someone')).toEqual(['Music'])
      expect((await fs.stat('/Users'))?.isDirectory).toBe(true)
      expect(await fs.stat('/Applications')).toBeUndefined()
      expect(await names('/Users/someone/Music/samples/Lib1/Kick')).toEqual(['a.wav'])
      expect(await names('/Users/someone/Music/samples/Lib2/Kick')).toEqual(['1.wav'])
      expect(new TextDecoder().decode(await fs.readFile('/Volumes/Disk/a.wav'))).toBe('inner')
    })
  })
}

describe('a listed folder', () => {
  test('existence needs no file; a file is fetched once, when its size or content is needed', async () => {
    const fs = new WebFs([{ path: '/samples', source: listed(samples) }])
    expect(await fs.kind('/samples/Lib1/Kick/1.wav')).toBe('file')
    expect(await fs.kind('/samples/Lib1/Kick')).toBe('directory')
    expect(await fs.kind('/samples/Lib1/Kick/2.wav')).toBeUndefined()
    expect((await fs.listDir('/samples/Lib2/Kick'))?.length).toBe(1)
    expect(fs.usage).toEqual({ opened: 0, reads: 0, bytes: 0 })
    expect((await fs.stat('/samples/Lib1/Kick/1.wav'))?.size).toBe(2000324)
    await fs.read('/samples/Lib1/Kick/1.wav', 0, 16384)
    await fs.read('/samples/Lib1/Kick/1.wav', 16384, 100)
    expect(fs.usage).toEqual({ opened: 1, reads: 2, bytes: 16484 })
  })

  test('a file that cannot be fetched any more is missing, not an error for the whole run', async () => {
    const { name, files } = uploaded(samples)
    const fs = new WebFs([
      {
        path: '/samples',
        source: {
          kind: 'listing',
          name,
          paths: files.map((f) => f.path),
          open: async () => undefined,
        },
      },
    ])
    expect(await fs.kind('/samples/Lib1/Kick/1.wav')).toBe('file') // it is in the listing
    expect(await fs.file('/samples/Lib1/Kick/1.wav')).toBeUndefined()
    expect(await fs.stat('/samples/Lib1/Kick/1.wav')).toBeUndefined()
    expect(fs.read('/samples/Lib1/Kick/1.wav', 0, 10)).rejects.toThrow('No such file')
  })
})

describe('a folder behind a handle, which hides entries with some names', () => {
  /** A project folder as Chromium hands it out, inside a library folder. */
  function library() {
    const root = join(tmp.path, 'Music')
    writeFile(join(root, 'Projects', 'Song Project', 'Song.als'), 'set')
    writeFile(join(root, 'Projects', 'Song Project', 'Samples', 'Kick.wav'), 'RIFF kick')
    writeFile(join(root, 'Projects', 'Song Project', 'Samples', ' lead.wav'), 'RIFF lead')
    writeFile(join(root, 'Projects', 'Song Project', 'Samples', 'Claps:Snares', 'a.wav'), 'RIFF a')
    writeFile(join(root, 'Loops', 'Odd:Names', 'b.wav'), 'RIFF b')
    const handle = memoryFolder(join(root, 'Projects'))
    handle.hides = hiddenByHandle
    return { root, handle, projects: folderFromHandle(handle) }
  }
  const SAMPLES = '/Music/Projects/Song Project/Samples'

  test('what it hides is not there for the page, and such a place is said to be hidden', async () => {
    const { projects } = library()
    const fs = new WebFs([{ path: '/Music/Projects', source: projects }])
    expect((await fs.listDir(SAMPLES))?.map((e) => e.name)).toEqual(['Kick.wav'])
    expect(await fs.kind(`${SAMPLES}/ lead.wav`)).toBeUndefined()
    expect(await fs.kind(`${SAMPLES}/Claps:Snares/a.wav`)).toBeUndefined()
    // Neither seen nor to be made: by its own name, or by the name of a folder on the way.
    for (const place of [`${SAMPLES}/ lead.wav`, `${SAMPLES}/Claps:Snares/a.wav`])
      expect([place, fs.hides(place), fs.refuses(place)]).toEqual([place, true, true])
    expect([fs.hides(`${SAMPLES}/Kick.wav`), fs.refuses(`${SAMPLES}/New.wav`)]).toEqual([
      false,
      false,
    ])
    // Outside the folders that were given, nothing is known and nothing claimed.
    expect(fs.hides('/Elsewhere/ lead.wav')).toBe(false)
  })

  test('a folder that was given around it shows what the handle hides', async () => {
    const { root, projects } = library()
    for (const around of [uploaded(root), listed(root)]) {
      const fs = new WebFs([
        { path: '/Music', source: around },
        { path: '/Music/Projects', source: projects },
      ])
      expect((await fs.listDir(SAMPLES))?.map((e) => e.name).sort()).toEqual([
        ' lead.wav',
        'Claps:Snares',
        'Kick.wav',
      ])
      expect(await fs.kind(`${SAMPLES}/ lead.wav`)).toBe('file')
      expect(new TextDecoder().decode(await fs.readFile(`${SAMPLES}/ lead.wav`))).toBe('RIFF lead')
      // A folder with such a name, and what lies in it.
      expect((await fs.listDir(`${SAMPLES}/Claps:Snares`))?.map((e) => e.name)).toEqual(['a.wav'])
      expect((await fs.stat(`${SAMPLES}/Claps:Snares/a.wav`))?.size).toBe(6)
      // What the handle shows is read through the handle: it is the file as it is now.
      expect((await fs.stat(`${SAMPLES}/Kick.wav`))?.size).toBe(9)
      // Seen, so not hidden; made it still cannot be.
      expect([fs.hides(`${SAMPLES}/ lead.wav`), fs.refuses(`${SAMPLES}/ lead.wav`)]).toEqual([
        false,
        true,
      ])
      // The folder around is an upload: its own odd names were never hidden.
      expect(await fs.kind('/Music/Loops/Odd:Names/b.wav')).toBe('file')
      expect([
        fs.hides('/Music/Loops/Odd:Names/b.wav'),
        fs.refuses('/Music/Loops/x:y.wav'),
      ]).toEqual([false, false])
    }
  })

  test('the same folder, given once more as an upload or a drop, shows it too', async () => {
    const { root, handle, projects } = library()
    const again = join(root, 'Projects')
    // In either order: the handle is what is read, the other one what it hides. Or as one
    // folder: dropped to be edited, it brings what its handle hides.
    for (const mounts of [
      [projects, uploaded(again)],
      [listed(again), projects],
      [editable(droppedFolder(again, handle))],
    ]) {
      const fs = new WebFs(mounts.map((source) => ({ path: '/Music/Projects', source })))
      expect((await fs.listDir(SAMPLES))?.map((e) => e.name).sort()).toEqual([
        ' lead.wav',
        'Claps:Snares',
        'Kick.wav',
      ])
      expect(new TextDecoder().decode(await fs.readFile(`${SAMPLES}/ lead.wav`))).toBe('RIFF lead')
      expect((await fs.stat(`${SAMPLES}/Claps:Snares/a.wav`))?.size).toBe(6)
      expect([fs.hides(`${SAMPLES}/ lead.wav`), fs.refuses(`${SAMPLES}/ lead.wav`)]).toEqual([
        false,
        true,
      ])
      // Each entry is there once.
      expect((await fs.listDir('/Music/Projects'))?.map((e) => e.name)).toEqual(['Song Project'])
    }
  })

  test('only what the handle hides is taken from the folder around: a file that is gone stays gone', async () => {
    const { root, handle, projects } = library()
    const around = uploaded(root)
    // Deleted since the folder around was handed over: the handle no longer has it.
    const song = handle.entries.get('Song Project') as ReturnType<typeof memoryFolder>
    ;(song.entries.get('Samples') as ReturnType<typeof memoryFolder>).entries.delete('Kick.wav')
    const fs = new WebFs([
      { path: '/Music', source: around },
      { path: '/Music/Projects', source: projects },
    ])
    expect(await fs.kind(`${SAMPLES}/Kick.wav`)).toBeUndefined()
    expect(await fs.kind(`${SAMPLES}/ lead.wav`)).toBe('file')
  })
})

describe('folder uploads', () => {
  test('files are grouped by the folder that was chosen', () => {
    const file = (path: string) => {
      const f = new File(['x'], path.split('/').at(-1) as string)
      Object.defineProperty(f, 'webkitRelativePath', { value: path })
      return f
    }
    const folders = foldersFromFiles([
      file('Projects/Song Project/Song.als'),
      file('Projects/Song Project/Samples/Imported/Kick.wav'),
      file('Samples/Kick.wav'),
    ])
    expect(folders.map((f) => [f.name, f.kind === 'files' && f.files.map((x) => x.path)])).toEqual([
      ['Projects', ['Song Project/Song.als', 'Song Project/Samples/Imported/Kick.wav']],
      ['Samples', ['Kick.wav']],
    ])
  })
})

describe('codec and hash', () => {
  test('gzip round trip, and gunzip of what Live wrote', async () => {
    const text = new TextEncoder().encode('<?xml version="1.0"?><Ableton />'.repeat(100))
    expect(await webCodec.gunzip(await webCodec.gzip(text, 6))).toEqual(text)
    const set = readFileSync(join(tmp.path, 'projects', 'Brokenpath Project', 'Brokenpath.als'))
    const xml = await webCodec.gunzip(new Uint8Array(set))
    expect(new TextDecoder().decode(xml.subarray(0, 5))).toBe('<?xml')
    expect(webCodec.gunzip(new TextEncoder().encode('not gzip'))).rejects.toThrow()
  })

  test('sha1, piece by piece and in one go', async () => {
    const h = webHash.sha1()
    h.update(new TextEncoder().encode('abc'))
    expect(h.hex()).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
    const parts = ['a', 'bc'].map((s) => new TextEncoder().encode(s))
    expect(await webHash.sha1Of?.(parts)).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
  })

  test('hashes of a sample equal those of the Node host', async () => {
    const real = join(samples, 'Lib1', 'Kick', '1.wav')
    const node = createNodeHost()
    const onDisk = new Probe(node.fs, node.hash)
    const fs = new WebFs([{ path: '/samples', source: picked(samples) }])
    const inPage = new Probe(fs, webHash)
    const path = '/samples/Lib1/Kick/1.wav'
    expect(await inPage.audioHash(path)).toBe(await onDisk.audioHash(real))
    expect(await inPage.contentHash(path)).toBe(await onDisk.contentHash(real))
    expect(await inPage.fingerprint(path)).toEqual([2000324, 17226])
    expect(fs.usage.opened).toBe(1)
  })
})
