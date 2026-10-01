/** `undo` for status (tags, comments, rating sheet), reorg (folder moves) and move (sets and copies). */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  decodeTags,
  EMPTY_REMAP,
  encodeTags,
  type Host,
  TAGS_ATTR,
  type Tag,
} from '@livesaver/core'
import { createNodeHost, createXattr, FinderScriptComments } from '@livesaver/node'
import { Inventory } from '@livesaver/plugins'
import {
  arranged,
  fakeOsascript,
  liveSet,
  makeProject,
  midiClip,
  midiTrack,
  sampleSet,
  tempDir,
  writeFile,
  writeSet,
} from '@livesaver/test-kit'
import {
  DEFAULT_PROFILE,
  type EnvConfig,
  executeMove,
  Journal,
  planMove,
  relocation,
  runReorg,
  statusRun,
  undoRun,
} from '../src/index.js'

const PROFILE = DEFAULT_PROFILE
const ENV: EnvConfig = {
  userLibrary: '',
  factoryPacks: '',
  appResources: '',
  preferredRoots: [],
  vendorLibraries: [],
  remap: EMPTY_REMAP,
}
const xattr = createXattr()
const onMac = process.platform === 'darwin' ? describe : describe.skip
const readTags = async (path: string): Promise<Tag[]> =>
  decodeTags(await xattr?.get(path, TAGS_ATTR))

onMac('undo of M4 runs', () => {
  let tmp: { path: string; cleanup: () => void }
  let fake: ReturnType<typeof fakeOsascript>
  let host: Host
  const run = () => ({ id: 'r', dir: join(tmp.path, 'run') })

  beforeEach(() => {
    tmp = tempDir()
    fake = fakeOsascript()
    host = createNodeHost({
      write: true,
      trashDir: join(tmp.path, 'Trash'),
      finder: new FinderScriptComments(fake.runner),
    })
  })
  afterEach(() => tmp.cleanup())

  test('status: tags, comments and the rating sheet come back', async () => {
    const projects = join(tmp.path, 'Projects')
    const song = makeProject(join(projects, 'Remixes'), 'Song')
    const set = join(song, 'Song.als')
    writeSet(set, liveSet(arranged(12, 8, 10)))
    await xattr?.set(song, TAGS_ATTR, encodeTags([['Continue', 2]]))
    fake.comments.set(song, 'my note')
    const sheet = join(tmp.path, 'Ratings.csv')
    writeFile(sheet, 'Group,Project,Decision,Stars,Note\r\nProjects/Remixes,Song Project,,4,\r\n')
    const before = readFileSync(sheet)
    await statusRun(host, {
      targets: [projects],
      apply: true,
      env: ENV,
      inventory: new Inventory([]),
      profile: PROFILE,
      journal: new Journal(host, run()),
      sheet: { path: sheet, snapshot: join(tmp.path, 'snapshot.json') },
    })
    expect(await readTags(song)).toContainEqual(['4★', 0])
    expect(await readTags(set)).toContainEqual(['Elaborated', 0])
    expect(fake.comments.get(song)).toContain('‖ my note')
    expect(readFileSync(sheet)).not.toEqual(before)

    const report = await undoRun(host, run(), ENV)
    expect(report.problems).toEqual([])
    expect(await readTags(song)).toEqual([['Continue', 2]])
    expect(await readTags(set)).toEqual([])
    expect(fake.comments.get(song)).toBe('my note')
    expect(fake.comments.get(set)).toBe('')
    expect(readFileSync(sheet)).toEqual(before)
    expect(existsSync(join(tmp.path, 'snapshot.json'))).toBe(false) // created by the run: trashed
  })

  test('reorg: the folder goes back', async () => {
    const base = join(tmp.path, 'Projects')
    const song = makeProject(join(base, 'Remixes'), 'Song')
    writeFile(join(song, 'Samples', 'Imported', 'Song.wav'), 'RIFF song'.repeat(40))
    writeSet(join(song, 'Song.als'), sampleSet(song, ['Song.wav']))
    fake.comments.set(song, 'note')
    const target = join(base, '1 In Progress', 'Song Project')
    const moves = [relocation(song, target, 'Continue')]
    await runReorg({ host, env: ENV, profile: PROFILE }, moves, {
      base,
      apply: true,
      journal: new Journal(host, run()),
    })
    expect(moves[0]?.done).toBe(true)
    expect(existsSync(song)).toBe(false)
    const report = await undoRun(host, run(), ENV)
    expect(report.renamedBack).toEqual([song])
    expect(statSync(join(song, 'Song.als')).isFile()).toBe(true)
    expect(existsSync(target)).toBe(false)
  })

  test('move: sets and backups go back, the copies to the Trash', async () => {
    const parent = join(tmp.path, 'Music')
    const old = join(parent, 'Album Project')
    writeFile(join(old, 'Ableton Project Info', 'Project8_1.cfg'), 'ProjectInfo')
    writeFile(join(old, 'Samples', 'Imported', 'own.wav'), 'RIFF own'.repeat(100))
    writeSet(join(old, 'Album.als'), liveSet(midiTrack({ session: [midiClip(0, 4)] })))
    writeSet(join(old, 'Intro.als'), sampleSet(old, ['own.wav']))
    writeFile(
      join(old, 'Backup', 'Intro [2024-06-22 120000].als'),
      readFileSync(join(old, 'Intro.als')),
    )
    const target = join(parent, 'Intro Project')
    const ctx = { host, env: ENV }
    const m = await planMove(ctx, [join(old, 'Intro.als')], target)
    await executeMove(ctx, m, new Journal(host, run()))
    expect(m.done).toBe(true)
    expect(existsSync(join(old, 'Intro.als'))).toBe(false)
    const report = await undoRun(host, run(), ENV)
    expect(report.renamedBack.sort()).toEqual(
      [join(old, 'Intro.als'), join(old, 'Backup', 'Intro [2024-06-22 120000].als')].sort(),
    )
    expect(existsSync(join(old, 'Intro.als'))).toBe(true)
    expect(report.trashed.sort()).toEqual(
      [
        join(target, 'Ableton Project Info', 'Project8_1.cfg'),
        join(target, 'Samples', 'Imported', 'own.wav'),
      ].sort(),
    )
    expect(readdirSync(join(tmp.path, 'Trash')).sort()).toEqual(['Project8_1.cfg', 'own.wav'])
  })
})
