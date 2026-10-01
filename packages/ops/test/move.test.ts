/** move: sets of another song move into a project of their own. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { csvRecords, EMPTY_REMAP, fileRefs, openDocument } from '@livesaver/core'
import { createNodeHost } from '@livesaver/node'
import {
  MOVE_HEAD,
  MOVE_TAIL,
  readSet,
  sampleSet,
  tempDir,
  testCodec,
  writeFile,
  writeSet,
} from '@livesaver/test-kit'
import {
  backupsOf,
  type EnvConfig,
  Environment,
  executeMove,
  formatMovePlan,
  moveReport,
  Probe,
  parseMovePlan,
  planMove,
  resolveExisting,
  suggestMoves,
} from '../src/index.js'

const ENV: EnvConfig = {
  userLibrary: '',
  factoryPacks: '',
  appResources: '',
  preferredRoots: [],
  vendorLibraries: [],
  remap: EMPTY_REMAP,
}

describe('moving sets (MoveTest)', () => {
  let tmp: { path: string; cleanup: () => void }
  let parent: string
  let old: string
  let target: string
  let sets: string[]

  beforeEach(() => {
    tmp = tempDir()
    parent = join(tmp.path, 'Music')
    old = join(parent, 'Album Project')
    writeFile(join(old, 'Ableton Project Info', 'Project8_1.cfg'), 'ProjectInfo')
    writeFile(join(old, 'Samples', 'Imported', 'shared.wav'), 'RIFF shared'.repeat(100))
    writeFile(join(old, 'Samples', 'Imported', 'own.wav'), 'RIFF own'.repeat(100))
    writeFile(join(old, 'Samples', 'Imported', 'own.wav.asd'), 'analysis')
    writeFile(join(old, 'Samples', 'Imported', 'own2.wav'), 'RIFF own2'.repeat(100))
    writeSet(join(old, 'Album.als'), sampleSet(old, ['shared.wav']))
    for (const name of ['Intro', 'outro'])
      writeSet(join(old, `${name}.als`), sampleSet(old, ['shared.wav', 'own.wav', 'own2.wav']))
    mkdirSync(join(old, 'Backup'))
    cpSync(join(old, 'Intro.als'), join(old, 'Backup', 'Intro [2024-06-22 120000].als'), {
      preserveTimestamps: true,
    })
    cpSync(join(old, 'Album.als'), join(old, 'Backup', 'Album [2023-10-06 100000].als'), {
      preserveTimestamps: true,
    })
    target = join(parent, 'Intro Project')
    sets = [join(old, 'Intro.als'), join(old, 'outro.als')]
  })
  afterEach(() => tmp.cleanup())

  const ctx = (write = false) => ({
    host: createNodeHost({ write, trashDir: join(tmp.path, 'Trash') }),
    env: ENV,
  })
  const files = () => {
    const out: [string, bigint][] = []
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name)
        if (e.isDirectory()) walk(p)
        else out.push([p, statSync(p, { bigint: true }).mtimeNs])
      }
    }
    walk(tmp.path)
    return out.sort()
  }

  test('a dry run changes nothing', async () => {
    const before = files()
    const m = await planMove(ctx(), sets, target)
    expect(m.problems).toEqual([])
    expect(m.newProject).toBe(true)
    expect(m.copies.map(([, dst]) => basename(dst)).sort()).toEqual([
      'own.wav',
      'own2.wav',
      'shared.wav',
    ])
    expect(m.backups.map(([, next]) => basename(next))).toEqual(['Intro [2024-06-22 120000].als'])
    expect(files()).toEqual(before)
  })

  test('sets, backups and samples move into a new project', async () => {
    const mtime = statSync(sets[0] as string, { bigint: true }).mtimeNs
    const c = ctx(true)
    const m = await planMove(c, sets, target)
    await executeMove(c, m)
    expect([m.problems, m.done]).toEqual([[], true])
    expect(
      readdirSync(target)
        .filter((f) => f.endsWith('.als'))
        .sort(),
    ).toEqual(['Intro.als', 'outro.als'])
    expect(statSync(join(target, 'Intro.als'), { bigint: true }).mtimeNs).toBe(mtime)
    expect(readFileSync(join(target, 'Ableton Project Info', 'Project8_1.cfg'), 'utf8')).toBe(
      'ProjectInfo',
    )
    expect(existsSync(join(target, 'Samples', 'Imported', 'own.wav.asd'))).toBe(true)
    expect(existsSync(join(target, 'Backup', 'Intro [2024-06-22 120000].als'))).toBe(true)
    // the old project keeps its set, its backup and all its files (copied, not moved)
    expect(
      readdirSync(old)
        .filter((f) => f.endsWith('.als'))
        .sort(),
    ).toEqual(['Album.als'])
    expect(readdirSync(join(old, 'Backup'))).toEqual(['Album [2023-10-06 100000].als'])
    expect(existsSync(join(old, 'Samples', 'Imported', 'own.wav'))).toBe(true)
    expect(m.unusedAfter).toEqual(['Samples/Imported/own.wav', 'Samples/Imported/own2.wav'])
    // the moved set is unchanged and its references now find the files of the new project
    const doc = await openDocument(
      new Uint8Array(readFileSync(join(target, 'Intro.als'))),
      testCodec,
    )
    const probe = new Probe(c.host.fs, c.host.hash)
    const env = new Environment(ENV, probe)
    for (const ref of fileRefs(doc)) {
      const found = await resolveExisting(ref, target, target, env, probe)
      expect(dirname(found as string)).toBe(join(target, 'Samples', 'Imported'))
    }
  })

  test('an existing project with the same set name', async () => {
    writeFile(join(target, 'Ableton Project Info', 'Project8_1.cfg'), 'ProjectInfo')
    writeSet(join(target, 'Intro.als'), MOVE_HEAD + MOVE_TAIL)
    const c = ctx(true)
    const m = await planMove(c, sets.slice(0, 1), target)
    await executeMove(c, m)
    expect(m.problems).toEqual([])
    expect(existsSync(join(target, 'Intro (from Album).als'))).toBe(true)
    expect(existsSync(join(target, 'Backup', 'Intro (from Album) [2024-06-22 120000].als'))).toBe(
      true,
    )
    expect(readSet(join(target, 'Intro.als'))).toBe(MOVE_HEAD + MOVE_TAIL)
  })

  test('another file of the same name in the target blocks the move', async () => {
    writeFile(join(target, 'Ableton Project Info', 'Project8_1.cfg'), 'ProjectInfo')
    writeFile(join(target, 'Samples', 'Imported', 'own.wav'), 'RIFF something else')
    const m = await planMove(ctx(), sets, target)
    expect(m.problems).toHaveLength(1)
    expect(m.problems[0]).toContain('own.wav')
  })

  test('a target file that matches the fingerprint is used', async () => {
    // the set was made with the file now in the target; the old project has an updated copy
    mkdirSync(join(target, 'Samples', 'Imported'), { recursive: true })
    copyFileSync(
      join(old, 'Samples', 'Imported', 'own.wav'),
      join(target, 'Samples', 'Imported', 'own.wav'),
    )
    writeFile(join(target, 'Ableton Project Info', 'Project8_1.cfg'), 'ProjectInfo')
    writeFile(join(old, 'Samples', 'Imported', 'own.wav'), 'RIFF upd'.repeat(100)) // same size
    const c = ctx(true)
    const m = await planMove(c, sets.slice(0, 1), target)
    expect([m.problems, m.reused]).toEqual([[], ['Samples/Imported/own.wav']])
    await executeMove(c, m)
    expect([m.problems, m.done]).toEqual([[], true])
  })

  test('suggestions and a plan', async () => {
    const sunrise = join(parent, 'Sunrise Project')
    writeFile(join(sunrise, 'Ableton Project Info', 'Project8_1.cfg'), 'x')
    writeFile(join(sunrise, 'Samples', 'Imported', 'kick.wav'), 'RIFF kick'.repeat(50))
    writeFile(join(sunrise, 'Samples', 'Imported', 'vox.wav'), 'RIFF vox'.repeat(50))
    for (const [name, used] of [
      ['Sunrise', ['kick.wav']],
      ['Sunrise 2', ['kick.wav']],
      ['Sunrise Fix', ['kick.wav']],
      ['b', ['vox.wav']],
    ] as const)
      writeSet(join(sunrise, `${name}.als`), sampleSet(sunrise, used))
    const rows = await suggestMoves(ctx(), [parent], [])
    const found = new Set(rows.map((r) => `${basename(r.set)} → ${basename(r.target)}`))
    expect(found).toEqual(
      new Set(['Intro.als → Intro Project', 'outro.als → outro Project', 'b.als → b Project']),
    )
    const planned = parseMovePlan(formatMovePlan(rows), (p) => p)
    const moves = []
    for (const [t, s] of planned) moves.push(await planMove(ctx(), s, t))
    expect(csvRecords(moveReport(moves, parent, false)).records).toHaveLength(3)
    expect(existsSync(join(sunrise, 'b.als'))).toBe(true) // dry run
  })

  test('backups of a short name', async () => {
    writeFile(join(old, 'Backup', 'b [2020-05-01 120000].als'), '')
    writeFile(join(old, 'Backup', 'b [2020-05-01 120000] 2.als'), '')
    writeFile(join(old, 'Backup', 'b 2 [2020-05-01 120000].als'), '')
    const host = createNodeHost()
    const found = await backupsOf(host, join(old, 'b.als'), new Probe(host.fs, host.hash))
    expect(found.map((b) => basename(b))).toEqual([
      'b [2020-05-01 120000] 2.als',
      'b [2020-05-01 120000].als',
    ])
  })
})
