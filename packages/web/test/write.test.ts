/**
 * Writing through folder handles, as a page in Chrome or Edge may in a folder its user chose for
 * editing: over folders in memory that behave like a browser's handles.
 */
import { describe, expect, test } from 'bun:test'
import { MemoryDirectory, MemoryFile, memoryFiles } from '@livesaver/test-kit'
import { folderFromHandle, TRASH_FOLDER, WebFs, WebFsWrite } from '../src/index.js'

const bytes = (text: string) => new TextEncoder().encode(text)
const text = (data: Uint8Array) => new TextDecoder().decode(data)

async function folder(name: string, files: Readonly<Record<string, string>>) {
  const root = new MemoryDirectory(name)
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split('/')
    const file = parts.pop() as string
    let dir = root
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true })
    dir.entries.set(file, new MemoryFile(file, bytes(content), 1_700_000_000_000))
  }
  return root
}

/** A project folder the page may write to, and a library it may only read. */
async function setup() {
  const projects = await folder('Projects', {
    'Song Project/Song.als': 'the set as Live saved it',
    'Song Project/Samples/Recorded/Take.wav': 'RIFF take',
  })
  const library = await folder('Library', { 'Drums/Kick.wav': 'RIFF kick' })
  const fs = new WebFs([
    { path: '/music/Projects', source: folderFromHandle(projects) },
    { path: '/library', source: folderFromHandle(library) },
  ])
  const write = new WebFsWrite(
    fs,
    [{ path: '/music/Projects', handle: projects }],
    new Date('2026-10-03T12:00:00.000Z'),
  )
  const names = () => [...memoryFiles(projects).keys()]
  return { projects, library, fs, write, names }
}

const SET = '/music/Projects/Song Project/Song.als'
const IMPORTED = '/music/Projects/Song Project/Samples/Imported/Kick.wav'

describe('a copy', () => {
  test('goes from a folder that is only read into the project, and is seen there at once', async () => {
    const { fs, write, names } = await setup()
    // The folder was listed before: what is written into it must show all the same.
    expect((await fs.listDir('/music/Projects/Song Project/Samples'))?.map((e) => e.name)).toEqual([
      'Recorded',
    ])
    await write.copyFile('/library/Drums/Kick.wav', IMPORTED)
    expect(text(await fs.readFile(IMPORTED))).toBe('RIFF kick')
    expect((await fs.stat(IMPORTED))?.size).toBe(9)
    expect(
      (await fs.listDir('/music/Projects/Song Project/Samples'))?.map((e) => e.name).sort(),
    ).toEqual(['Imported', 'Recorded'])
    expect(names()).toContain('Song Project/Samples/Imported/Kick.wav')
  })

  test('never overwrites, and says so when its source is not there', async () => {
    const { write, projects } = await setup()
    await write.copyFile('/library/Drums/Kick.wav', IMPORTED)
    expect(write.copyFile('/library/Drums/Kick.wav', IMPORTED)).rejects.toThrow(
      `refusing to overwrite ${IMPORTED}`,
    )
    // A folder of that name counts as taken, too.
    expect(
      write.copyFile('/library/Drums/Kick.wav', '/music/Projects/Song Project/Samples'),
    ).rejects.toThrow('refusing to overwrite')
    expect(write.copyFile('/library/Drums/Gone.wav', `${IMPORTED}.2`)).rejects.toThrow(
      'No such file: /library/Drums/Gone.wav',
    )
    expect(memoryFiles(projects).get('Song Project/Samples/Imported/Kick.wav')?.writes).toBe(1)
  })

  test('that fails leaves no empty file under its name', async () => {
    const { write, names } = await setup()
    const original = MemoryFile.prototype.createWritable
    MemoryFile.prototype.createWritable = async () => ({
      write: async () => {
        throw new Error('the disk is full')
      },
      close: async () => {},
      abort: async () => {},
    })
    try {
      expect(write.copyFile('/library/Drums/Kick.wav', IMPORTED)).rejects.toThrow(
        'the disk is full',
      )
      await write.copyFile('/library/Drums/Kick.wav', IMPORTED).catch(() => {})
    } finally {
      MemoryFile.prototype.createWritable = original
    }
    expect(names()).not.toContain('Song Project/Samples/Imported/Kick.wav')
  })
})

describe('a set', () => {
  test('is replaced in one write, and read anew afterwards', async () => {
    const { fs, write, projects } = await setup()
    expect(text(await fs.readFile(SET))).toBe('the set as Live saved it')
    await write.replaceFile(SET, bytes('the set with its references repaired'))
    expect(text(await fs.readFile(SET))).toBe('the set with its references repaired')
    expect(memoryFiles(projects).get('Song Project/Song.als')?.writes).toBe(1)
    // A set is replaced, never made.
    expect(
      write.replaceFile('/music/Projects/Song Project/Other.als', bytes('x')),
    ).rejects.toThrow()
    expect([...memoryFiles(projects).keys()]).not.toContain('Song Project/Other.als')
  })
})

describe('a file behind a handle', () => {
  test('is asked for anew when its state is asked: one that was saved since is another file', async () => {
    const { fs, projects } = await setup()
    const set = memoryFiles(projects).get('Song Project/Song.als') as MemoryFile
    const before = await fs.stat(SET)
    expect(text(await fs.readFile(SET))).toBe('the set as Live saved it')
    // Live saves the set while the page has it.
    set.data = bytes('the set as Live saved it again')
    set.modified += 60_000
    const after = await fs.stat(SET)
    expect(after?.size).toBe(30)
    expect(after?.mtimeNs).toBe((before?.mtimeNs ?? 0n) + 60_000_000_000n)
    expect(text(await fs.readFile(SET))).toBe('the set as Live saved it again')
  })
})

describe('files of livesaver’s own', () => {
  test('a new file is not written over an old one; a maintained file is', async () => {
    const { fs, write } = await setup()
    const report = '/music/Projects/Song Project/report.csv'
    await write.writeNew(report, 'a,b\n')
    expect(write.writeNew(report, 'c,d\n')).rejects.toThrow(`refusing to overwrite ${report}`)
    expect(text(await fs.readFile(report))).toBe('a,b\n')
    await write.writeFile(report, 'c,d\n')
    expect(text(await fs.readFile(report))).toBe('c,d\n')
    await write.writeFile('/music/Projects/new folder/state.json', bytes('{}'))
    expect(text(await fs.readFile('/music/Projects/new folder/state.json'))).toBe('{}')
  })

  test('a journal grows line by line, and each line is there when the call returns', async () => {
    const { fs, write } = await setup()
    const journal = '/music/Projects/run/journal.jsonl'
    for (const line of ['{"id":1}', '{"id":2}', '{"id":3}']) {
      await write.appendDurable(journal, line)
      expect(text(await fs.readFile(journal)).endsWith(`${line}\n`)).toBe(true)
    }
    expect(text(await fs.readFile(journal))).toBe('{"id":1}\n{"id":2}\n{"id":3}\n')
  })

  test('where a file can be opened for writing in place (a page’s own storage), a line is added there', async () => {
    const { fs, write, projects } = await setup()
    const flushed: number[] = []
    const run = await projects.getDirectoryHandle('run', { create: true })
    const file = new MemoryFile('journal.jsonl')
    run.entries.set('journal.jsonl', file)
    Object.assign(file, {
      createSyncAccessHandle: async () => ({
        getSize: () => file.data.length,
        write: (data: Uint8Array, { at }: { at: number }) => {
          const next = new Uint8Array(at + data.length)
          next.set(file.data)
          next.set(data, at)
          file.data = next
          return data.length
        },
        flush: () => void flushed.push(file.data.length),
        close: () => {},
      }),
    })
    await write.appendDurable('/music/Projects/run/journal.jsonl', 'one')
    await write.appendDurable('/music/Projects/run/journal.jsonl', 'two')
    expect(text(await fs.readFile('/music/Projects/run/journal.jsonl'))).toBe('one\ntwo\n')
    expect(flushed).toEqual([4, 8])
  })
})

describe('taking something out', () => {
  test('moves it to a hidden folder of the folder it was in: a page has no Trash', async () => {
    const { fs, write, names } = await setup()
    await write.copyFile('/library/Drums/Kick.wav', IMPORTED)
    await write.trash(IMPORTED)
    expect(await fs.kind(IMPORTED)).toBeUndefined()
    const kept = `${TRASH_FOLDER}/2026-10-03T12-00-00-000Z/Song Project/Samples/Imported/Kick.wav`
    expect(names()).toContain(kept)
    expect(text(await fs.readFile(`/music/Projects/${kept}`))).toBe('RIFF kick')
    // The folder it lay in stays, empty.
    expect(await fs.kind('/music/Projects/Song Project/Samples/Imported')).toBe('directory')
  })

  test('a file is moved to a free name; a folder cannot be moved', async () => {
    const { fs, write } = await setup()
    const from = '/music/Projects/Song Project/Samples/Recorded/Take.wav'
    const to = '/music/Projects/Song Project/Samples/Processed/Take 2.wav'
    await write.rename(from, to)
    expect([await fs.kind(from), text(await fs.readFile(to))]).toEqual([undefined, 'RIFF take'])
    expect(write.rename(SET, to)).rejects.toThrow(`refusing to overwrite ${to}`)
    expect(
      write.rename('/music/Projects/Song Project', '/music/Projects/Other Project'),
    ).rejects.toThrow('A page can move a file, but not a folder')
    expect(await fs.kind(SET)).toBe('file')
  })
})

describe('what the page may not do', () => {
  test('writing outside the folders it was given for that is refused', async () => {
    const { write, library } = await setup()
    for (const attempt of [
      () => write.copyFile(SET, '/library/Drums/Song.als'),
      () => write.writeFile('/library/x.txt', 'x'),
      () => write.replaceFile('/library/Drums/Kick.wav', bytes('x')),
      () => write.trash('/library/Drums/Kick.wav'),
      () => write.mkdirp('/elsewhere/folder'),
      () => write.appendDurable('/music/journal.jsonl', 'x'),
    ])
      expect(attempt()).rejects.toThrow('This page may not write here')
    expect([...memoryFiles(library).keys()]).toEqual(['Drums/Kick.wav'])
  })

  test('a name the browser refuses to make is said by its name, not taken for a file that is there', async () => {
    const { write, projects } = await setup()
    const song = await projects.getDirectoryHandle('Song Project')
    // As Chromium does for a name with a colon, or with a space at an end.
    const refuse = (name: string) => {
      if (name.includes(':')) throw new TypeError('Name is not allowed.')
    }
    const { getFileHandle, getDirectoryHandle } = song
    song.getFileHandle = async (name, options) => {
      refuse(name)
      return getFileHandle.call(song, name, options)
    }
    song.getDirectoryHandle = async (name, options) => {
      refuse(name)
      return getDirectoryHandle.call(song, name, options)
    }
    const said = (name: string) => `The browser lets a page make no file or folder named “${name}”.`
    expect(
      write.copyFile('/library/Drums/Kick.wav', '/music/Projects/Song Project/Kick: 1.wav'),
    ).rejects.toThrow(said('Kick: 1.wav'))
    expect(write.writeFile('/music/Projects/Song Project/a:b.txt', 'x')).rejects.toThrow(
      said('a:b.txt'),
    )
    expect(
      write.copyFile(
        '/library/Drums/Kick.wav',
        '/music/Projects/Song Project/Claps: Snares/Kick.wav',
      ),
    ).rejects.toThrow(said('Claps: Snares'))
    expect(write.mkdirp('/music/Projects/Song Project/a:b/c')).rejects.toThrow(said('a:b'))
  })

  test('folders are made on the way; how much room there is, a page cannot see', async () => {
    const { fs, write } = await setup()
    await write.mkdirp('/music/Projects/Song Project/Samples/Imported/Deep/Deeper')
    expect(await fs.kind('/music/Projects/Song Project/Samples/Imported/Deep/Deeper')).toBe(
      'directory',
    )
    expect(await write.freeBytes()).toBeUndefined()
  })
})
