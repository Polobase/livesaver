/** reorg: sort project folders into status folders. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, statSync } from 'node:fs'
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
import {
  fakeOsascript,
  foreignRef,
  makeProject,
  sampleSet,
  tempDir,
  writeFile,
  writeSet,
} from '@livesaver/test-kit'
import {
  CompleteSets,
  DEFAULT_PROFILE,
  type EnvConfig,
  emptyFolders,
  type Relocation,
  relocation,
  runReorg,
  suggestReorg,
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

async function readTags(path: string): Promise<Tag[]> {
  return decodeTags(await xattr?.get(path, TAGS_ATTR))
}

onMac('reorg (ReorgTest)', () => {
  let tmp: { path: string; cleanup: () => void }
  let base: string
  let song: string
  let old: string
  let undecided: string

  const project = async (group: string, name: string, ...tags: string[]) => {
    const root = makeProject(join(base, group), name)
    writeFile(join(root, 'Samples', 'Imported', `${name}.wav`), `RIFF ${name}`.repeat(50))
    writeSet(join(root, `${name}.als`), sampleSet(root, [`${name}.wav`]))
    if (tags.length) await xattr?.set(root, TAGS_ATTR, encodeTags(tags.map((t) => [t, 0] as const)))
    return root
  }

  beforeEach(async () => {
    tmp = tempDir()
    base = join(tmp.path, 'Projects')
    song = await project('Remixes', 'Song', 'Continue')
    old = await project(join('Old', '2014'), 'Oldie', 'Archive')
    undecided = await project('Studio', 'Open')
  })
  afterEach(() => tmp.cleanup())

  const host = (fake = fakeOsascript()): Host =>
    createNodeHost({
      write: true,
      trashDir: join(tmp.path, 'Trash'),
      finder: new FinderScriptComments(fake.runner),
    })
  const ctx = (h: Host) => ({ host: h, env: ENV, profile: PROFILE })
  const plan = async (): Promise<Relocation[]> =>
    (await suggestReorg(host(), [base], base, PROFILE))
      .filter((r) => r.target)
      .map((r) => relocation(r.project, r.target, r.decision))

  test('the suggestion follows the decision tags', async () => {
    const conflicting = await project('Studio', 'Two', 'Delete', 'Archive')
    const inPlace = await project('1 In Progress', 'Finished', 'Continue')
    const idea = await project('2 Ideas', 'Idea', 'Archive')
    const rows = Object.fromEntries(
      (await suggestReorg(host(), [base], base, PROFILE)).map((r) => [r.project, r]),
    )
    expect(rows[song]?.target).toBe(join(base, '1 In Progress', 'Song Project'))
    expect(rows[old]?.target).toBe(join(base, '4 Archive', 'Old', '2014', 'Oldie Project'))
    expect(rows[idea]?.target).toBe(join(base, '4 Archive', 'Idea Project'))
    expect([rows[conflicting]?.target, rows[conflicting]?.note.slice(0, 17)]).toEqual([
      '',
      'several decisions',
    ])
    expect(rows[undecided]).toBeUndefined()
    expect(rows[inPlace]).toBeUndefined()
  })

  test('a move keeps tags, comment and references', async () => {
    const fake = fakeOsascript({ [song]: 'Elaborated · 5:00 ‖ Drop!' })
    const oldSet = join(song, 'Song.als')
    const stat = statSync(oldSet, { bigint: true })
    const cache = new CompleteSets(0)
    const fileStat = {
      size: Number(stat.size),
      mtimeSec: 0,
      mtimeNs: stat.mtimeNs,
      ctimeNs: stat.ctimeNs,
      ino: stat.ino,
      dev: stat.dev,
      isFile: true,
      isDirectory: false,
    }
    cache.store(
      oldSet,
      fileStat,
      '',
      { ok: 1, kept: 0, external: 0, found: 0, 'not-found': 0, ambiguous: 0, mismatch: 0 },
      [join(song, 'Samples', 'Imported', 'Song.wav')],
    )
    cache.store(
      '/gone/Gone.als',
      fileStat,
      '',
      { ok: 0, kept: 0, external: 0, found: 0, 'not-found': 0, ambiguous: 0, mismatch: 0 },
      [],
    )
    const moves = await plan()
    const r = await runReorg(ctx(host(fake)), moves, { base, apply: true, cache })
    expect(r.started).toBe(true)
    expect(moves.map((m) => [m.done, m.problems])).toEqual([
      [true, []],
      [true, []],
    ])
    const target = join(base, '1 In Progress', 'Song Project')
    expect(existsSync(song)).toBe(false)
    expect(await readTags(target)).toEqual([['Continue', 0]])
    expect(fake.comments.get(target)).toBe('Elaborated · 5:00 ‖ Drop!')
    expect(statSync(join(base, '4 Archive', 'Old', '2014', 'Oldie Project')).isDirectory()).toBe(
      true,
    )
    expect(cache.paths()).toEqual([join(target, 'Song.als')])
    const saved = JSON.parse(cache.serialize()).sets[join(target, 'Song.als')]
    expect(saved.files).toEqual([join(target, 'Samples', 'Imported', 'Song.wav')])
    expect(await emptyFolders(host(), [base])).toEqual([join(base, 'Old'), join(base, 'Remixes')])
  })

  test('a dry run changes nothing', async () => {
    const moves = await plan()
    await runReorg(ctx(host()), moves, { base, apply: false })
    expect(statSync(song).isDirectory()).toBe(true)
    expect(moves.map((m) => m.problems)).toEqual([[], []])
  })

  test('an existing target is never replaced', async () => {
    makeProject(join(base, '1 In Progress'), 'Song')
    const moves = await plan()
    await runReorg(ctx(host()), moves, { base, apply: true })
    const m = moves.find((x) => x.source === song) as Relocation
    expect(m.done).toBe(false)
    expect(m.problems).toContain('target exists already – nothing is ever replaced')
    expect(existsSync(join(song, 'Song.als'))).toBe(true)
  })

  test('a project whose files another set uses stays', async () => {
    const shared = join(song, 'Samples', 'Imported', 'Song.wav')
    writeSet(join(undecided, 'Borrowed.als'), foreignRef(shared))
    const moves = await plan()
    await runReorg(ctx(host()), moves, { base, apply: true })
    const m = moves.find((x) => x.source === song) as Relocation
    expect(m.done).toBe(false)
    expect(m.problems[0]).toContain('Borrowed.als uses files from it (Song.wav)')
    expect(statSync(song).isDirectory()).toBe(true)
  })

  test('the rename is taken back when a reference breaks', async () => {
    writeFile(join(base, 'Remixes', 'Shared', 'x.wav'), 'RIFF x')
    writeSet(join(song, 'Relative.als'), foreignRef('/nowhere/x.wav', 1, '../Shared/x.wav'))
    const moves = await plan()
    await runReorg(ctx(host()), moves, { base, apply: true })
    const m = moves.find((x) => x.source === song) as Relocation
    expect(m.done).toBe(false)
    expect(m.problems[0]).toContain('renamed back')
    expect(statSync(song).isDirectory()).toBe(true)
    expect(existsSync(join(base, '1 In Progress', 'Song Project'))).toBe(false)
  })
})
