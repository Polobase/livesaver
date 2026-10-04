/** A run's journal as a summary and as steps, for `livesaver runs` and a history page. */
import { describe, expect, test } from 'bun:test'
import {
  type JournalEntry,
  parseRunId,
  type RunRecord,
  runSteps,
  runSummary,
  runText,
} from '../src/index.js'

const SET = '/music/Song Project/Song.als'
const COPY = '/music/Song Project/Samples/Imported/Kick.wav'

/** A fix of one set: the sample is copied, then the set is rewritten. */
const FIX: JournalEntry[] = [
  { t: 'begin', id: 1, op: 'copy', source: '/library/Kick.wav', destination: COPY },
  { t: 'end', id: 1, op: 'copy', asd: false, sha1: 'aa' },
  {
    t: 'begin',
    id: 2,
    op: 'write-set',
    set: SET,
    backup: '/music/Song Project/Backup/Song [2026-10-03 143005].als',
    original: '/runs/x/originals/2-Song.als',
    sha1: 'bb',
  },
  { t: 'end', id: 2, op: 'write-set' },
]

describe('the name of a run folder', () => {
  test('says when it started, what it was, and whether it wrote', () => {
    expect(parseRunId('2026-10-03_143005_collect_apply')).toEqual({
      when: '2026-10-03 14:30:05',
      command: 'collect',
      applied: true,
    })
    // A codemod's name has dashes and underscores of its own; a second run in a second is numbered.
    expect(parseRunId('2026-10-03_143005_run-rename_track_dry-run-2')).toEqual({
      when: '2026-10-03 14:30:05',
      command: 'run-rename_track',
      applied: false,
    })
    expect(parseRunId('something else')).toEqual({
      when: '',
      command: 'something else',
      applied: false,
    })
  })
})

describe('a run in a few numbers', () => {
  const ID = '2026-10-03_143005_collect_apply'

  test('a fix that stands can be undone', () => {
    const run = runSummary(ID, FIX)
    expect(run).toMatchObject({
      command: 'collect',
      applied: true,
      state: 'applied',
      sets: 1,
      files: 1,
      unfinished: 0,
      canUndo: true,
    })
    expect(runText(run)).toBe('1 set written, 1 file copied')
  })

  test('undone, in part or as a whole', () => {
    expect(runSummary(ID, FIX).standing).toEqual({ sets: 1, files: 1 })
    const restored: JournalEntry[] = [...FIX, { t: 'undo', id: 2, result: 'restored' }]
    // The copy stays while a set that was changed since uses it: a later undo can take it away.
    expect(runSummary(ID, restored)).toMatchObject({
      state: 'partly-undone',
      canUndo: true,
      standing: { sets: 0, files: 1 },
    })
    const all: JournalEntry[] = [...restored, { t: 'undo', id: 1, result: 'trashed' }]
    expect(runSummary(ID, all)).toMatchObject({
      state: 'undone',
      canUndo: false,
      standing: { sets: 0, files: 0 },
    })
    // A copy that was gone already counts as taken back, too.
    const gone: JournalEntry[] = [...restored, { t: 'undo', id: 1, result: 'gone' }]
    expect(runSummary(ID, gone)).toMatchObject({ state: 'undone', canUndo: false })
    // A set someone changed since is left alone, and no later undo touches it either.
    const changed: JournalEntry[] = [
      ...FIX,
      { t: 'undo', id: 2, result: 'changed-since' },
      { t: 'undo', id: 1, result: 'trashed' },
    ]
    expect(runSummary(ID, changed)).toMatchObject({ state: 'undone', canUndo: false })
    expect(runSteps(changed).map((step) => [step.op, step.undone])).toEqual([
      ['copy', 'trashed'],
      ['write-set', 'changed-since'],
    ])
  })

  test('a dry run, a run with nothing to do, and one that was killed', () => {
    expect(runSummary('2026-10-03_143005_collect_dry-run', [])).toMatchObject({
      applied: false,
      state: 'dry-run',
      canUndo: false,
    })
    expect(runText(runSummary('2026-10-03_143005_collect_dry-run', []))).toBe('dry run')
    const nothing = runSummary(ID, [])
    expect([nothing.state, runText(nothing)]).toEqual(['nothing', 'nothing changed'])
    const killed = runSummary(ID, FIX.slice(0, 3))
    expect(killed).toMatchObject({ state: 'applied', sets: 0, files: 1, unfinished: 1 })
  })

  test('tags, comments, moves and the rating sheet are counted', () => {
    const entries: JournalEntry[] = [
      { t: 'begin', id: 1, op: 'tags', path: '/music/Song Project', before: null, after: '00' },
      { t: 'end', id: 1, op: 'tags' },
      {
        t: 'begin',
        id: 2,
        op: 'comments',
        items: [
          { path: '/music/Song Project', before: '', after: 'a' },
          { path: SET, before: '', after: 'b' },
        ],
      },
      { t: 'end', id: 2, op: 'comments' },
      { t: 'begin', id: 3, op: 'rename', from: '/music/Song Project', to: '/music/Done/Song' },
      { t: 'end', id: 3, op: 'rename' },
      {
        t: 'begin',
        id: 4,
        op: 'replace-file',
        path: '/music/Ratings.csv',
        original: null,
        sha1: 'c',
      },
      { t: 'end', id: 4, op: 'replace-file' },
    ]
    const run = runSummary('2026-10-03_143005_status_apply', entries)
    expect(run).toMatchObject({ tags: 1, comments: 2, renames: 1, ownFiles: 1 })
    expect(runText(run)).toBe('1 moved, 1 tag set, 2 comments set, 1 file of livesaver replaced')
    expect(runSteps(entries).map((step) => [step.op, step.path, step.from])).toEqual([
      ['tags', '/music/Song Project', ''],
      ['comments', `/music/Song Project\n${SET}`, ''],
      ['rename', '/music/Done/Song', '/music/Song Project'],
      ['replace-file', '/music/Ratings.csv', ''],
    ])
  })

  test('what the run was asked comes with it, where it was written down', () => {
    const record: RunRecord = {
      version: 1,
      command: 'collect',
      apply: true,
      targets: ['/music'],
      options: { certainOnly: true },
      started: '2026-10-03T12:30:05.000Z',
      ended: '2026-10-03T12:30:09.000Z',
      outcome: { sets: 1, files: 1 },
    }
    expect(runSummary(ID, FIX, record).record).toEqual(record)
    expect(runSummary(ID, FIX).record).toBeUndefined()
  })
})

describe('the steps of a run', () => {
  test('a rewritten set comes with its backup, a copy with its source', () => {
    expect(runSteps(FIX)).toEqual([
      {
        op: 'copy',
        path: COPY,
        from: '/library/Kick.wav',
        backup: '',
        at: '',
        finished: true,
        undone: '',
      },
      {
        op: 'write-set',
        path: SET,
        from: '',
        backup: '/music/Song Project/Backup/Song [2026-10-03 143005].als',
        at: '',
        finished: true,
        undone: '',
      },
    ])
  })
})
