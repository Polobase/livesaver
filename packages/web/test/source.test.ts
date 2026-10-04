/** Folders as a drop hands them over: listed through the entries API, files fetched when read. */
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  copyFixtures,
  droppedFolder,
  memoryFolder,
  tempDir,
  uploadedFolder,
  writeFile,
} from '@livesaver/test-kit'
import {
  editable,
  editableFromDrop,
  type FolderSource,
  foldersFromDrop,
  hiddenByHandle,
  lostBehindHandle,
  WebFs,
} from '../src/index.js'

let tmp: { path: string; cleanup: () => void }
let samples: string
beforeEach(() => {
  tmp = tempDir()
  samples = copyFixtures(tmp.path).samples
})
afterEach(() => tmp.cleanup())

/** Calls of `file()`: a file must only be fetched when it is read. */
let fetched: string[] = []
beforeEach(() => {
  fetched = []
})

/** A file or folder as the entries API shows it; folders are listed two entries at a time. */
function entryOf(path: string, isDirectory: boolean): unknown {
  const name = basename(path)
  if (!isDirectory) {
    return {
      isDirectory: false,
      name,
      file: (done: (file: File) => void) => {
        fetched.push(name)
        done(new File([readFileSync(path)], name))
      },
    }
  }
  return {
    isDirectory: true,
    name,
    createReader() {
      const entries = readdirSync(path, { withFileTypes: true }).map((e) =>
        entryOf(join(path, e.name), e.isDirectory()),
      )
      return { readEntries: (done: (batch: unknown[]) => void) => done(entries.splice(0, 2)) }
    },
  }
}

interface Item {
  kind: string
  webkitGetAsEntry: () => unknown
  getAsFileSystemHandle?: () => Promise<unknown>
}

const folder = (dir: string): Item => ({ kind: 'file', webkitGetAsEntry: () => entryOf(dir, true) })

const drop = (items: Item[], onFiles?: (count: number) => void) =>
  foldersFromDrop(items as unknown as DataTransferItemList, onFiles)

const listing = (source: FolderSource | undefined) => {
  if (source?.kind !== 'listing') throw new Error('expected a listing')
  return source
}

test('a dropped folder is listed: every file with its path, no file fetched', async () => {
  // Names a directory handle would hide: a ':' (shown as '/' by Finder), a leading space.
  writeFile(join(samples, 'Claps:Snares', ' clap.wav'), 'RIFF')
  const counts: number[] = []
  const [source, ...more] = await drop([folder(samples)], (count) => counts.push(count))
  expect(more).toEqual([])
  expect(source?.name).toBe('samples')
  const expected = uploadedFolder(samples).files.map((f) => f.path)
  expect(expected).toContain('Claps:Snares/ clap.wav')
  expect([...listing(source).paths].sort()).toEqual(expected.sort())
  expect(counts.at(-1)).toBe(expected.length)
  expect(counts).toEqual([...counts].sort((a, b) => a - b))
  expect(fetched).toEqual([])
})

test('a file of a dropped folder is fetched when it is read', async () => {
  const [source] = await drop([folder(samples)])
  const { paths, open } = listing(source)
  const kick = await open(paths.indexOf('Lib1/Kick/1.wav'))
  expect(kick?.size).toBe(readFileSync(join(samples, 'Lib1', 'Kick', '1.wav')).length)
  expect(fetched).toEqual(['1.wav'])
  expect(await open(paths.length)).toBeUndefined()

  const fs = new WebFs([{ path: '/samples', source: listing(source) }])
  expect((await fs.stat('/samples/Lib2/Kick/1.wav'))?.size).toBe(
    readFileSync(join(samples, 'Lib2', 'Kick', '1.wav')).length,
  )
  expect(await fs.kind('/samples/Lib1/Kick/1.wav.asd')).toBe('file')
  expect(fetched).toEqual(['1.wav', '1.wav'])
})

test('a file that is gone when it is read is like a file that is not there', async () => {
  const gone = {
    isDirectory: true,
    name: 'folder',
    createReader() {
      const entries = [
        {
          isDirectory: false,
          name: 'gone.wav',
          file: (_done: unknown, failed: (error: Error) => void) => failed(new Error('gone')),
        },
      ]
      return { readEntries: (done: (batch: unknown[]) => void) => done(entries.splice(0, 2)) }
    },
  }
  const [source] = await drop([{ kind: 'file', webkitGetAsEntry: () => gone }])
  expect(await listing(source).open(0)).toBeUndefined()
  const fs = new WebFs([{ path: '/folder', source: listing(source) }])
  expect(await fs.stat('/folder/gone.wav')).toBeUndefined()
})

test('several folders can be dropped at once; dropped files and text are not folders', async () => {
  const wav = join(samples, 'Lib1', 'Kick', '1.wav')
  const sources = await drop([
    { kind: 'string', webkitGetAsEntry: () => null },
    folder(join(samples, 'Lib1')),
    { kind: 'file', webkitGetAsEntry: () => entryOf(wav, false) },
    folder(join(samples, 'Lib2')),
  ])
  expect(sources.map((s) => `${s.kind} ${s.name}`)).toEqual(['listing Lib1', 'listing Lib2'])
  expect([...listing(sources[0]).paths].sort()).toEqual(['Kick/1.wav', 'Kick/1.wav.asd'])
})

test('where the browser also hands out a handle for a dropped folder, it is taken along', async () => {
  const handle = { kind: 'directory', name: 'Lib1', values: async function* () {} }
  const [kept, system, none, plain] = await drop([
    { ...folder(join(samples, 'Lib1')), getAsFileSystemHandle: async () => handle },
    // A folder of the system: the browser hands out no handle for it, or fails to.
    { ...folder(join(samples, 'Lib2')), getAsFileSystemHandle: async () => null },
    {
      ...folder(join(samples, 'Lib1', 'Kick')),
      getAsFileSystemHandle: () => Promise.reject(new Error('not allowed')),
    },
    // A browser that knows no handles.
    folder(samples),
  ])
  expect(listing(kept).kept).toBe(handle as never)
  // The folder is read through its entries all the same: they show every file.
  expect(listing(kept).paths).toContain('Kick/1.wav')
  expect([listing(system).kept, listing(none).kept, listing(plain).kept]).toEqual([
    undefined,
    undefined,
    undefined,
  ])
})

test('a browser that never hands out the handle does not keep the dropped folder from arriving', async () => {
  // (Seen in a private window of Chromium, once its folder access has stopped answering.)
  const [source] = await drop([
    { ...folder(join(samples, 'Lib1')), getAsFileSystemHandle: () => new Promise(() => {}) },
  ])
  expect(listing(source).paths).toContain('Kick/1.wav')
  expect(listing(source).kept).toBeUndefined()
})

test('which names a handle hides, and how many files of a folder that costs', () => {
  expect(
    ['Kick.wav', 'Claps:Snares', ' clap.wav', 'clap.wav ', 'a?.wav', 'Icon\r', 'a|b'].map(
      hiddenByHandle,
    ),
  ).toEqual([false, true, true, true, true, true, true])
  expect(
    lostBehindHandle([
      'Kick/1.wav',
      // Everything below a folder with such a name is gone with it.
      'Claps:Snares/a.wav',
      'Claps:Snares/b.wav',
      'Loops/ lead.wav',
      // What a scan passes over anyway is no loss: a folder's icon, what lies in a hidden folder.
      'Loops/Icon\r',
      '.Trash/a:b.wav',
      'Loops/._a:b.wav',
    ]),
  ).toBe(3)
  expect(lostBehindHandle(['Kick/1.wav', 'Loops/2.wav'])).toBe(0)
})

test('a dropped folder that is to be edited: its handle, with what the handle hides from the drop', async () => {
  writeFile(join(samples, 'Claps:Snares', 'clap.wav'), 'RIFF clap')
  writeFile(join(samples, 'Lib1', ' lead.wav'), 'RIFF lead')
  const handle = memoryFolder(samples)
  const [source] = await editableFromDrop([
    { ...folder(samples), getAsFileSystemHandle: async () => handle },
  ] as unknown as DataTransferItemList)
  if (source?.kind !== 'handle') throw new Error('expected a handle')
  expect([source.name, source.handle === handle]).toEqual(['samples', true])
  // Of everything the drop listed, only what the handle will not show is kept beside it.
  expect([...(source.hidden?.paths ?? [])].sort()).toEqual([
    'Claps:Snares/clap.wav',
    'Lib1/ lead.wav',
  ])
  const at = source.hidden?.paths.indexOf('Lib1/ lead.wav') ?? -1
  expect(fetched).toEqual([])
  expect(await (await source.hidden?.open(at))?.text()).toBe('RIFF lead')
  expect(fetched).toEqual([' lead.wav'])
  expect(await source.hidden?.open(99)).toBeUndefined()
})

test('a folder with no such name is its handle alone; one without a handle stays a listing', () => {
  const handle = memoryFolder(samples)
  expect(editable(droppedFolder(samples, handle))).toEqual({
    kind: 'handle',
    name: 'samples',
    handle,
  })
  // (Firefox and Safari hand out no handle: the folder can be read, not edited.)
  const listed = droppedFolder(samples)
  expect(editable(listed)).toBe(listed)
  const uploaded = uploadedFolder(samples)
  expect(editable(uploaded)).toBe(uploaded)
})
