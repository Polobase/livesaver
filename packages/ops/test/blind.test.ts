/**
 * A host that sees and makes less than Node does: a browser shows a page no entry with certain
 * names in a folder it hands over, and makes none there (`FsRead.hides`, `FsRead.refuses`). A
 * file the host cannot see may well be where its set expects it, so no other is taken for it;
 * and nothing is planned that the host cannot write, or a fix fails for the whole set.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type FsRead, type FsWrite, type Host, liveCrc, posix, REL_PROJECT } from '@livesaver/core'
import { createNodeHost } from '@livesaver/node'
import { deviceSet, makeProject, writeFile, writeSet } from '@livesaver/test-kit'
import { checkView, type Environment, isInside } from '../src/index.js'
import { csv, useCollect } from './collect-kit.js'

const { tmp, run } = useCollect()

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

/** As a browser has it: a name with a space at its start. */
const ODD = ' odd.wav'

/**
 * Node's host, but below `root` it makes nothing whose name starts with a space, and shows
 * nothing of that name either, unless `sees` (as when another folder shows what is there).
 * `silent`: it does not say so beforehand, and is found out when something is written.
 */
function narrowHost(root: string, sees = false, silent = false): Host {
  const host = createNodeHost({ write: true })
  const odd = (path: string) => {
    const at = posix.normpath(path)
    return (
      isInside(at, root) &&
      posix
        .relpath(at, root)
        .split('/')
        .some((name) => name.startsWith(' '))
    )
  }
  const hidden = (path: string) => !sees && odd(path)
  const fs: FsRead = {
    stat: async (path) => (hidden(path) ? undefined : host.fs.stat(path)),
    read: (path, offset, length) => host.fs.read(path, offset, length),
    readFile: (path) => host.fs.readFile(path),
    listDir: async (path) =>
      hidden(path)
        ? undefined
        : (await host.fs.listDir(path))?.filter((entry) => !hidden(posix.join(path, entry.name))),
    ...(silent ? {} : { hides: hidden, refuses: odd }),
  }
  const inner = host.write as FsWrite
  const refuse = (path: string) => {
    if (odd(path)) throw new TypeError('Name is not allowed.')
  }
  // As a browser does: it makes nothing with such a name, whatever is asked of it.
  const write: FsWrite = {
    mkdirp: async (path) => {
      refuse(path)
      await inner.mkdirp(path)
    },
    copyFile: async (source, destination) => {
      refuse(destination)
      await inner.copyFile(source, destination)
    },
    replaceFile: async (path, data, modified) => {
      refuse(path)
      await inner.replaceFile(path, data, modified)
    },
    writeNew: async (path, data) => {
      refuse(path)
      await inner.writeNew(path, data)
    },
    appendDurable: (path, line) => inner.appendDurable(path, line),
    freeBytes: (path) => inner.freeBytes(path),
    trash: (path) => inner.trash(path),
    rename: (from, to) => inner.rename(from, to),
    writeFile: async (path, data) => {
      refuse(path)
      await inner.writeFile(path, data)
    },
  }
  return { ...host, fs, write }
}

/** What a run left missing: the sample, why, and what was found for it. */
const left = (r: Awaited<ReturnType<typeof run>>) =>
  r.results.flatMap((set) =>
    set.missing.map((m) => [m.ref.name, m.choice.status, m.choice.blind, m.choice.candidates]),
  )

describe('a host that shows no file with certain names', () => {
  test('a sample it cannot see is left alone: no other file is taken for it', async () => {
    const projects = join(tmp.path, 'projects')
    const project = makeProject(projects, 'Song')
    const data = bytes('RIFF the sample of the song')
    const own = writeFile(join(project, 'Samples', ODD), data)
    const setPath = join(project, 'Song.als')
    writeSet(setPath, sampleSet(own, data, `Samples/${ODD}`))
    // The same sample lies in a library, where the host sees it.
    const library = join(tmp.path, 'library')
    writeFile(join(library, ODD), data)
    const before = readFileSync(setPath)

    // Node sees it: the set is complete.
    const seen = await run([projects], [library])
    expect([seen.results[0]?.counts.ok, seen.results[0]?.changes]).toEqual([1, []])

    const r = await run([projects], [library], { apply: true, host: narrowHost(projects) })
    expect(r.results[0]?.error).toBe('')
    expect(left(r)).toEqual([[ODD, 'not-found', 'unseen', []]])
    expect(r.results[0]?.decisions.map((d) => [d.status, d.method])).toEqual([
      ['not-found', 'cannot be seen here: the file may be where the set expects it'],
    ])
    // Nothing was done: no copy, and the set is as it was.
    expect([r.results[0]?.changes, r.results[0]?.written]).toEqual([[], false])
    expect(existsSync(join(project, 'Samples', 'Imported'))).toBe(false)
    expect(readFileSync(setPath)).toEqual(before)
    // The report says why it is listed.
    expect(csv(r.reports['missing_samples.csv'] ?? '').map((row) => row.Status)).toEqual([
      'cannot be seen here: the file may be where the set expects it',
    ])
  })

  test('a place the set names elsewhere counts too: its stored path, the folder of the set', async () => {
    const projects = join(tmp.path, 'projects')
    const project = makeProject(projects, 'Song')
    const data = bytes('RIFF recorded into another project')
    // Stored by its path in another project of the folder, in a folder the host hides.
    const other = writeFile(join(projects, 'Other Project', ' Takes', 'take.wav'), data)
    writeSet(join(project, 'Song.als'), sampleSet(other, data))
    const library = join(tmp.path, 'library')
    writeFile(join(library, 'take.wav'), data)

    const r = await run([projects], [library], { apply: true, host: narrowHost(projects) })
    expect(left(r)).toEqual([['take.wav', 'not-found', 'unseen', []]])
    expect(existsSync(join(project, 'Samples', 'Imported'))).toBe(false)
  })
})

describe('what such a host kept livesaver from', () => {
  test('is counted under a source of its own, apart from what is missing', async () => {
    const projects = join(tmp.path, 'projects')
    const project = makeProject(projects, 'Song')
    const data = bytes('RIFF the sample of the song')
    const own = writeFile(join(project, 'Samples', ODD), data)
    writeSet(join(project, 'Song.als'), sampleSet(own, data, `Samples/${ODD}`))
    // A sample that is nowhere: missing, whatever the host sees.
    const snare = bytes('RIFF a snare that is gone')
    writeSet(join(project, 'Other.als'), sampleSet('/Volumes/Gone/Kit/snare.wav', snare))

    const r = await run([projects], [], { host: narrowHost(projects) })
    const view = checkView(r, r.projects[0]?.env as Environment)
    expect(view.missing.map((m) => [m.name, m.blind, m.sourceKind, m.sourceName])).toEqual([
      ['snare.wav', '', 'Folder', '/Volumes/Gone/Kit'],
      [ODD, 'unseen', 'Browser limit', 'Files the browser does not show'],
    ])
    expect(view.missingSources.map((s) => [s.kind, s.name, s.samples, s.advice])).toEqual([
      ['Browser limit', 'Files the browser does not show', 1, 'unseen'],
      ['Folder', '/Volumes/Gone/Kit', 1, 'folder'],
    ])
    expect(view.missingSources[0]?.hint).toContain(
      'They may be where the sets expect them: in a folder chosen for editing, a browser shows a page no file or folder with such a name.',
    )
    // The reports say the same.
    expect(
      csv(r.reports['missing_sources.csv'] ?? '').map((row) => [row.Kind, row.Source]),
    ).toEqual([
      ['Browser limit', 'Files the browser does not show'],
      ['Folder', '/Volumes/Gone/Kit'],
    ])
    expect(r.reports['overview.md']).toContain('| Not shown by the browser | 1 | 1 |')
  })
})

describe('a host that makes no file with certain names', () => {
  test('a file that was found is not copied to such a name, and its set is not touched', async () => {
    const projects = join(tmp.path, 'projects')
    const project = makeProject(projects, 'Song')
    const data = bytes('RIFF of a drive that is gone')
    const setPath = join(project, 'Song.als')
    writeSet(setPath, sampleSet(`/Volumes/Gone/Loops/${ODD}`, data))
    const library = join(tmp.path, 'library')
    const found = writeFile(join(library, 'Loops', ODD), data)
    const before = readFileSync(setPath)

    // Node copies it into the project under its own name.
    const plan = await run([projects], [library])
    expect(plan.results[0]?.changes.map((c) => [c.action, c.newPath])).toEqual([
      ['repaired', `Samples/Imported/${ODD}`],
    ])

    const r = await run([projects], [library], { apply: true, host: narrowHost(projects) })
    expect(r.results[0]?.error).toBe('')
    expect(left(r)).toEqual([[ODD, 'not-found', 'unmade', [found]]])
    expect([r.results[0]?.changes, r.projects[0]?.copiedFiles]).toEqual([[], 0])
    expect(readFileSync(setPath)).toEqual(before)
    expect(csv(r.reports['missing_samples.csv'] ?? '').map((row) => row.Status)).toEqual([
      'found, but no file of this name can be made here',
    ])
  })

  test('a file with a name that can be made goes to the next place, when its own cannot be', async () => {
    const projects = join(tmp.path, 'projects')
    const project = makeProject(projects, 'Song')
    const data = bytes('RIFF once recorded here')
    const setPath = join(project, 'Song.als')
    // The set expects it in a folder of the project that the host can make nothing in.
    const wanted = join(project, 'Samples', ' Takes', 'take.wav')
    writeSet(setPath, sampleSet(wanted, data, 'Samples/ Takes/take.wav'))
    const library = join(tmp.path, 'library')
    writeFile(join(library, 'take.wav'), data)

    // The host is shown what is there (by a folder around): the file is not, so it is looked for.
    const r = await run([projects], [library], { apply: true, host: narrowHost(projects, true) })
    expect(r.results[0]?.error).toBe('')
    expect(r.results[0]?.changes.map((c) => [c.action, c.newPath])).toEqual([
      ['repaired', 'Samples/Imported/take.wav'],
    ])
    expect(existsSync(join(project, 'Samples', 'Imported', 'take.wav'))).toBe(true)
    expect(existsSync(wanted)).toBe(false)
    expect(r.results[0]?.written).toBe(true)
  })

  test('a file outside the project that cannot be copied in stays where the set has it', async () => {
    const projects = join(tmp.path, 'projects')
    const project = makeProject(projects, 'Song')
    const data = bytes('RIFF in a folder beside the projects')
    const outside = writeFile(join(tmp.path, 'elsewhere', ODD), data)
    const setPath = join(project, 'Song.als')
    writeSet(setPath, sampleSet(outside, data))
    const before = readFileSync(setPath)

    // Node collects it.
    const plan = await run([projects], [])
    expect(plan.results[0]?.changes.map((c) => c.action)).toEqual(['collected'])

    const r = await run([projects], [], { apply: true, host: narrowHost(projects) })
    expect(r.results[0]?.error).toBe('')
    expect([r.results[0]?.counts.ok, r.results[0]?.changes, left(r)]).toEqual([1, [], []])
    expect(readFileSync(setPath)).toEqual(before)
  })

  test('a set it can read and not rewrite is checked, and nothing is done for it', async () => {
    const projects = join(tmp.path, 'projects')
    // The project folder itself has such a name: the host reads in it through a folder around.
    const project = makeProject(projects, ' Song')
    const data = bytes('RIFF of a drive that is gone')
    const setPath = join(project, 'Song.als')
    writeSet(setPath, sampleSet('/Volumes/Gone/Loops/loop.wav', data))
    const library = join(tmp.path, 'library')
    const found = writeFile(join(library, 'Loops', 'loop.wav'), data)
    const before = readFileSync(setPath)

    const r = await run([projects], [library], { apply: true, host: narrowHost(projects, true) })
    expect(r.results.map((set) => [set.setPath, set.error])).toEqual([[setPath, '']])
    expect(left(r)).toEqual([['loop.wav', 'not-found', 'locked', [found]]])
    expect([r.results[0]?.changes, r.projects[0]?.copiedFiles]).toEqual([[], 0])
    expect(existsSync(join(project, 'Samples'))).toBe(false)
    expect(readFileSync(setPath)).toEqual(before)
    expect(csv(r.reports['missing_samples.csv'] ?? '').map((row) => row.Status)).toEqual([
      'found, but the set cannot be rewritten here',
    ])
  })

  test('a copy the host refuses after all is not counted, and each set that needs it says so', async () => {
    const projects = join(tmp.path, 'projects')
    const project = makeProject(projects, 'Song')
    const data = bytes('RIFF of a drive that is gone')
    for (const name of ['A.als', 'B.als'])
      writeSet(join(project, name), sampleSet(`/Volumes/Gone/Loops/${ODD}`, data))
    const library = join(tmp.path, 'library')
    writeFile(join(library, 'Loops', ODD), data)

    // This host does not say what it refuses: it is found out when the file is copied.
    const host = narrowHost(projects, true, true)
    const r = await run([projects], [library], { apply: true, host })
    expect(r.results.map((set) => [set.written, set.error])).toEqual([
      [false, 'Name is not allowed.'],
      [false, 'Name is not allowed.'],
    ])
    // Nothing was copied, and the run says so.
    expect([r.projects[0]?.copiedFiles, r.projects[0]?.copiedBytes]).toEqual([0, 0])
    expect(existsSync(join(project, 'Samples', 'Imported'))).toBe(false)
  })
})
