/**
 * Sets that were last saved by an older Live can be left out of a run (`minLive`): old saves
 * that are kept as they were, beside newer ones of the same song. Such a set is not checked,
 * not listed and not fixed.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { liveCrc, liveMajor } from '@livesaver/core'
import { createNodeHost } from '@livesaver/node'
import { deviceSet, makeProject, writeFile, writeSet } from '@livesaver/test-kit'
import { CompleteSets, checkView, doctor, type Environment, summary } from '../src/index.js'
import { env, useCollect } from './collect-kit.js'

const { tmp, run } = useCollect()

const bytes = (text: string) => new TextEncoder().encode(text)
const NOW = 'Ableton Live 12.3.2'
/** A set of today with one sample on a drive that is gone, or the same as another Live saved it. */
const sampleSet = (path: string, data: Uint8Array, creator = NOW) =>
  deviceSet(path, data.length, liveCrc(data), { relPath: `../../..${path}` })
    .replaceAll('MxPatchRef', 'SampleRef')
    .replace(`Creator="${NOW}"`, `Creator="${creator}"`)

/**
 * A song that was saved again over the years: the first save by Live 9, the newest by Live 12.
 * Both look for the same sample, which lies in a library.
 */
function song() {
  const project = makeProject(tmp.path, 'Song')
  const data = bytes('RIFF a loop of a drive that is gone')
  const library = join(tmp.path, 'library')
  writeFile(join(library, 'Loops', 'loop.wav'), data)
  const old = writeSet(
    join(project, 'Song.als'),
    sampleSet('/Volumes/Gone/Loops/loop.wav', data, 'Ableton Live 9.7.7'),
  )
  const now = writeSet(join(project, 'Song 2.als'), sampleSet('/Volumes/Gone/Loops/loop.wav', data))
  return { project, library, old, now }
}

describe('the Live that saved a set', () => {
  test('is read off its Creator', () => {
    expect(
      [
        'Ableton Live 9.1.1',
        'Ableton Live 10.1',
        'Ableton Live 12.3.2',
        'Ableton Live 12.0b21',
      ].map(liveMajor),
    ).toEqual([9, 10, 12, 12])
    // A file that does not say is of no version.
    expect(['', 'Some other program 9'].map(liveMajor)).toEqual([0, 0])
  })
})

describe('sets saved with an older Live', () => {
  test('are checked and fixed like any other, unless a version is asked for', async () => {
    const { project, library, old, now } = song()
    const r = await run([project], [library])
    expect(r.results.map((set) => [set.setPath, set.creator, set.changes.length])).toEqual([
      [now, NOW, 1],
      [old, 'Ableton Live 9.7.7', 1],
    ])
    expect(r.leftOut).toBe(0)
  })

  test('are left out below the version that is asked for: not listed, not fixed', async () => {
    const { project, library, old, now } = song()
    const before = readFileSync(old)
    const r = await run([project], [library], { apply: true, minLive: 10 })
    expect(r.results.map((set) => [set.setPath, set.written, set.error])).toEqual([[now, true, '']])
    expect(r.leftOut).toBe(1)
    // The old save is as it was; the new one has its sample.
    expect(readFileSync(old)).toEqual(before)
    expect(existsSync(join(project, 'Samples', 'Imported', 'loop.wav'))).toBe(true)
    // What a screen and the console say of the run.
    const view = checkView(r, r.projects[0]?.env as Environment)
    expect([view.sets, view.leftOut, view.setRows.map((row) => row.name)]).toEqual([
      1,
      1,
      ['Song 2.als'],
    ])
    expect(summary(r.results, r.projects, true, { sets: r.leftOut, minLive: 10 })).toContain(
      '  left out (saved with a Live older than 10): 1',
    )
    expect(summary(r.results, r.projects, true)).not.toContain('left out')
  })

  test('the version asked for is the oldest that is still checked', async () => {
    const { project, library, now, old } = song()
    // Live 9 is not older than 9: both sets are checked.
    expect((await run([project], [library], { minLive: 9 })).results.map((s) => s.setPath)).toEqual(
      [now, old],
    )
    // Asked for 13, nothing of today is checked either.
    const none = await run([project], [library], { minLive: 13 })
    expect([none.results, none.leftOut]).toEqual([[], 2])
  })

  test('a set that does not say which Live saved it is not left out', async () => {
    const project = makeProject(tmp.path, 'Song')
    const data = bytes('RIFF a loop')
    writeFile(join(project, 'Samples', 'loop.wav'), data)
    const set = writeSet(
      join(project, 'Song.als'),
      sampleSet(join(project, 'Samples', 'loop.wav'), data, ''),
    )
    const r = await run([project], [], { minLive: 12 })
    expect(r.results.map((s) => [s.setPath, s.creator])).toEqual([[set, '']])
    expect(r.leftOut).toBe(0)
  })

  test('one that was noted as complete in an earlier run is left out as well', async () => {
    const project = makeProject(tmp.path, 'Song')
    const data = bytes('RIFF a loop')
    const sample = writeFile(join(project, 'Samples', 'loop.wav'), data)
    writeSet(join(project, 'Song.als'), sampleSet(sample, data, 'Ableton Live 9.7.7'))
    const host = createNodeHost()
    const cache = new CompleteSets(50_000_000)
    const asked = { targets: [project], searchRoots: [], env: env(), cache }
    // Complete, and noted so: the next run does not read it again.
    expect((await doctor(host, asked)).results.map((s) => s.skipped)).toEqual([false])
    expect((await doctor(host, asked)).results.map((s) => s.skipped)).toEqual([true])
    const r = await doctor(host, { ...asked, minLive: 10 })
    expect([r.results, r.leftOut]).toEqual([[], 1])
  })
})
