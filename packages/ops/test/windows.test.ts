/**
 * Projects on a disk with drive letters, as Windows has them. Live writes such a path into a
 * set with slashes (`C:/Music/…`); a set of Live 9 or 10 stores it with backslashes. livesaver
 * was made on a Mac, where a path of Windows is one of a computer of long ago and is passed
 * over. Where the project itself lies on a drive, it is a path like any other.
 *
 * (No Windows is at hand: the drives here are folders of a temporary folder. What Live expects
 * to find in a set there is taken from sets that Live saved on Windows.)
 */
import { describe, expect, test } from 'bun:test'
import { cpSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  type FsRead,
  type FsWrite,
  type Host,
  liveCrc,
  REL_NONE,
  REL_PROJECT,
} from '@livesaver/core'
import { createNodeHost } from '@livesaver/node'
import { deviceSet, fixturesDir, OLD_SET, writeFile, writeSet } from '@livesaver/test-kit'
import { applyWriter, doctor, Environment, expectedPlaces, Probe } from '../src/index.js'
import { env, refsOf, useCollect } from './collect-kit.js'

const { tmp } = useCollect()

/** Where a drive lies on the disk of the test: `C:/Music` in the folder `C` of `root`. */
const onDisk = (root: string, path: string) =>
  path.replace(/^([A-Za-z]):\//, (_all, letter: string) => `${root}/${letter.toUpperCase()}/`)

/** Node's host over a disk with drive letters (see `onDisk`). */
function driveHost(root: string): Host {
  const host = createNodeHost({ write: true, trashDir: join(root, 'trash') })
  const at = (path: string) => onDisk(root, path)
  const fs: FsRead = {
    stat: (path) => host.fs.stat(at(path)),
    read: (path, offset, length) => host.fs.read(at(path), offset, length),
    readFile: (path) => host.fs.readFile(at(path)),
    listDir: (path) => host.fs.listDir(at(path)),
  }
  const inner = host.write as FsWrite
  const write: FsWrite = {
    mkdirp: (path) => inner.mkdirp(at(path)),
    copyFile: (source, destination) => inner.copyFile(at(source), at(destination)),
    replaceFile: (path, data, modified) => inner.replaceFile(at(path), data, modified),
    writeNew: (path, data) => inner.writeNew(at(path), data),
    appendDurable: (path, line) => inner.appendDurable(at(path), line),
    freeBytes: (path) => inner.freeBytes(at(path)),
    trash: (path) => inner.trash(at(path)),
    rename: (from, to) => inner.rename(at(from), at(to)),
    writeFile: (path, data) => inner.writeFile(at(path), data),
  }
  return { ...host, fs, write }
}

const bytes = (text: string) => new TextEncoder().encode(text)
/**
 * What stands beside a path with a drive in the references of a real library: no kind of
 * relative path, and the file's name alone.
 */
const DRIVE_REF = { relType: REL_NONE, relPath: 'loop.wav' }
const PROJECT = 'C:/Music/Song Project'

/** A fix of everything below `C:/Music`, with `D:/Samples` to search. */
async function fix(root: string) {
  const host = driveHost(root)
  const probe = new Probe(host.fs, host.hash)
  const run = { id: 'run', dir: join(root, 'run') }
  return doctor(host, {
    targets: ['C:/Music'],
    searchRoots: ['C:/Music', 'D:/Samples'],
    env: env(),
    probe,
    writer: applyWriter(host, run, probe),
  })
}

describe('a project on a drive', () => {
  test('a path of Windows is tried where the project lies on a drive, and nowhere else', async () => {
    const data = bytes('RIFF a loop')
    const set = writeSet(
      join(tmp.path, 'Song.als'),
      deviceSet('D:/Samples/Loops/loop.wav', data.length, liveCrc(data), DRIVE_REF).replaceAll(
        'MxPatchRef',
        'SampleRef',
      ),
    )
    const [ref] = await refsOf(set)
    if (!ref) throw new Error('no reference')
    const host = createNodeHost()
    const none = new Environment(env(), new Probe(host.fs, host.hash))
    // On a Mac: a path of a computer of long ago.
    expect(expectedPlaces(ref, '/Music/Song Project', '/Music/Song Project', none)).not.toContain(
      'D:/Samples/Loops/loop.wav',
    )
    expect(expectedPlaces(ref, PROJECT, PROJECT, none)).toContain('D:/Samples/Loops/loop.wav')
    // As Live 9 stores it: with backslashes.
    const old = { ...ref, path: 'D:\\Samples\\Loops\\loop.wav' }
    expect(expectedPlaces(old, PROJECT, PROJECT, none)).toContain('D:/Samples/Loops/loop.wav')
  })

  test('a path of a Mac is no file on Windows, but still says which of Live’s own files is meant', async () => {
    const set = writeSet(
      join(tmp.path, 'Song.als'),
      deviceSet('/Users/someone/Music/loop.wav', 4, 0).replaceAll('MxPatchRef', 'SampleRef'),
    )
    const [ref] = await refsOf(set)
    if (!ref) throw new Error('no reference')
    const host = createNodeHost()
    const resources = 'C:/ProgramData/Ableton/Live 12 Suite/Resources'
    const there = new Environment(
      { ...env(), appResources: resources },
      new Probe(host.fs, host.hash),
    )
    // Windows would open it as a file of the current drive; Live does not look there.
    expect(expectedPlaces(ref, PROJECT, PROJECT, there)).not.toContain(
      '/Users/someone/Music/loop.wav',
    )
    expect(expectedPlaces(ref, '/Music/Song Project', '/Music/Song Project', there)).toContain(
      '/Users/someone/Music/loop.wav',
    )
    // A file of the Live app the set was saved with on a Mac: the same file of this Live.
    const ofLive = {
      ...ref,
      path: '/Applications/Ableton Live 9 Suite.app/Contents/App-Resources/Core Library/Samples/x.wav',
    }
    const places = expectedPlaces(ofLive, PROJECT, PROJECT, there)
    expect(places).toContain(`${resources}/Core Library/Samples/x.wav`)
    expect(places).not.toContain(ofLive.path)
    // And one of a Live on Windows that is gone by now.
    const ofOldLive = {
      ...ref,
      path: 'C:\\ProgramData\\Ableton\\Live 9 Suite\\Resources\\Core Library\\Samples\\x.wav',
    }
    expect(expectedPlaces(ofOldLive, PROJECT, PROJECT, there).slice(-2)).toEqual([
      'C:/ProgramData/Ableton/Live 9 Suite/Resources/Core Library/Samples/x.wav',
      `${resources}/Core Library/Samples/x.wav`,
    ])
  })

  test('a sample on another drive is collected, and the set names it as Live does on Windows', async () => {
    const data = bytes('RIFF a loop on the sample drive')
    writeFile(join(tmp.path, 'C', 'Music', 'Song Project', 'Ableton Project Info', 'x.cfg'), '')
    writeFile(join(tmp.path, 'D', 'Samples', 'Loops', 'loop.wav'), data)
    const set = writeSet(
      join(tmp.path, 'C', 'Music', 'Song Project', 'Song.als'),
      deviceSet('D:/Samples/Loops/loop.wav', data.length, liveCrc(data), DRIVE_REF).replaceAll(
        'MxPatchRef',
        'SampleRef',
      ),
    )

    const r = await fix(tmp.path)
    expect(r.base).toBe('C:/Music')
    expect(r.results.map((s) => [s.setPath, s.written, s.error])).toEqual([
      [`${PROJECT}/Song.als`, true, ''],
    ])
    // The file was where its set says: it is collected, not looked for.
    expect(r.results[0]?.changes.map((c) => [c.action, c.newPath, c.source])).toEqual([
      ['collected', 'Samples/Imported/loop.wav', 'D:/Samples/Loops/loop.wav'],
    ])
    expect(
      existsSync(join(tmp.path, 'C', 'Music', 'Song Project', 'Samples', 'Imported', 'loop.wav')),
    ).toBe(true)
    // In the set: relative to the project, and the whole path with its drive and slashes.
    const [ref] = await refsOf(set)
    expect([ref?.relType, ref?.relPath, ref?.path]).toEqual([
      REL_PROJECT,
      'Samples/Imported/loop.wav',
      `${PROJECT}/Samples/Imported/loop.wav`,
    ])
    // Scanned again, the project is complete.
    const again = await fix(tmp.path)
    expect([again.results[0]?.counts.ok, again.results[0]?.changes]).toEqual([1, []])
  })

  test('a set of Live 10 with its path in backslashes is fixed the same, its hint without the drive', async () => {
    // The fixtures' sample, where the set of Live 10 says it lies: on drive E.
    const sample = join(fixturesDir(), 'samples', 'Lib1', 'Kick', '1.wav')
    cpSync(sample, join(tmp.path, 'E', 'Samples', 'Lib1', 'Kick', '1.wav'), { recursive: true })
    writeFile(join(tmp.path, 'C', 'Music', 'Song Project', 'Ableton Project Info', 'x.cfg'), '')
    // (The kit's set of Live 10 stores exactly that path, as Live does: UTF-16, backslashes.)
    const set = writeSet(join(tmp.path, 'C', 'Music', 'Song Project', 'Song.als'), OLD_SET)
    const [before] = await refsOf(set)
    expect(before?.path).toBe('E:\\Samples\\Lib1\\Kick\\1.wav')

    const r = await fix(tmp.path)
    expect(r.results.map((s) => [s.written, s.error])).toEqual([[true, '']])
    expect(r.results[0]?.changes.map((c) => [c.action, c.newPath, c.source])).toEqual([
      ['collected', 'Samples/Imported/1.wav', 'E:/Samples/Lib1/Kick/1.wav'],
    ])
    const [ref] = await refsOf(set)
    expect([ref?.relType, ref?.relPath]).toEqual([REL_PROJECT, 'Samples/Imported/1.wav'])
    // The hint names the folders without the drive, as Live 9 and 10 write it on Windows.
    expect(ref?.hintPath).toBe('/Music/Song Project/Samples/Imported/1.wav')
  })
})
