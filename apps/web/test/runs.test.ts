/** A run in the app's words: what it was, where and how, what an undo does, and on which day. */
import { describe, expect, test } from 'bun:test'
import type { Run } from '../src/engine/types.js'
import { moment } from '../src/lib/format.js'
import {
  byDay,
  changedSomething,
  commandOf,
  optionFacts,
  outcomeFacts,
  runFacts,
  runLook,
  startedAt,
  undoLines,
} from '../src/lib/runs.js'

const run = (extra: Partial<Run> = {}): Run => ({
  id: '2026-10-03_143005_collect_apply',
  when: '2026-10-03 14:30:05',
  command: 'collect',
  applied: true,
  state: 'applied',
  sets: 3,
  files: 12,
  renames: 0,
  tags: 0,
  comments: 0,
  ownFiles: 0,
  unfinished: 0,
  canUndo: true,
  reports: [],
  ...extra,
})

const record = (extra: Partial<NonNullable<Run['record']>> = {}): NonNullable<Run['record']> => ({
  version: 1,
  command: 'collect',
  apply: true,
  targets: ['/music/Projects'],
  options: {},
  started: new Date(2026, 9, 3, 14, 30, 5).toISOString(),
  ended: new Date(2026, 9, 3, 14, 30, 9).toISOString(),
  ...extra,
})

describe('what a run was', () => {
  test('is said as the result it left, or as a plan if nothing was to be written', () => {
    const title = (extra: Partial<Run>) => runLook(run(extra)).title
    expect(title({})).toBe('Fixed 3 sets, copied 12 files')
    expect(title({ sets: 1, files: 1 })).toBe('Fixed 1 set, copied 1 file')
    expect(title({ sets: 0, files: 0, state: 'nothing' })).toBe('A fix with nothing to do')
    expect(title({ applied: false, state: 'dry-run' })).toBe('Planned a fix (nothing was written)')
    expect(title({ command: 'vst3', sets: 2 })).toBe('Upgraded plug-ins to VST3 in 2 sets')
    expect(title({ command: 'vst3', applied: false })).toBe(
      'Planned a plug-in upgrade (nothing was written)',
    )
    expect(title({ command: 'plugin-audit', applied: false })).toBe('Plug-in audit')
    expect(title({ command: 'status', tags: 4, comments: 1 })).toBe(
      'Set 4 Finder tags and 1 comment',
    )
    expect(title({ command: 'reorg', renames: 2 })).toBe('Moved 2 project folders')
    expect(title({ command: 'reorg-plan', applied: false })).toBe('Wrote a plan to check')
    expect(title({ command: 'move' })).toBe('Moved sets into projects of their own')
    expect(title({ command: 'run-rename-tracks', sets: 5 })).toBe(
      'Codemod rename-tracks: 5 sets changed',
    )
    expect(title({ command: 'run-rename-tracks', applied: false })).toBe(
      'Codemod rename-tracks (nothing was written)',
    )
    // A command of a later version is shown as it is named.
    expect(runLook(run({ command: 'something-new' }))).toEqual({
      title: 'something-new',
      icon: 'i-lucide-circle',
    })
  })

  test('only runs that changed something count as changes', () => {
    expect(changedSomething(run())).toBe(true)
    expect(changedSomething(run({ state: 'undone' }))).toBe(true)
    expect(changedSomething(run({ state: 'nothing' }))).toBe(false)
    expect(changedSomething(run({ applied: false, state: 'dry-run' }))).toBe(false)
  })

  test('where it worked and what was unusual about it, in a line', () => {
    expect(runFacts(run())).toEqual([])
    expect(runFacts(run({ record: record() }))).toEqual(['In Projects'])
    const many = ['/m/A Project', '/m/B Project', '/m/C Project', '/m/D Project', '/m/E Project']
    expect(
      runFacts(
        run({
          record: record({
            targets: many,
            options: { certainOnly: true, matchLibraryPath: true, plugin: [] },
          }),
        }),
      ),
    ).toEqual([
      'In A Project, B Project, C Project and 2 more',
      'uncertain matches left out',
      'library files accepted by their place',
    ])
    expect(
      runFacts(run({ command: 'vst3', record: record({ options: { plugin: ['Serum'] } }) })),
    ).toEqual(['In Projects', 'only Serum'])
    // It was killed (it never noted its end), or it stopped with an error.
    const { ended: _ended, ...killed } = record()
    expect(runFacts(run({ record: killed }))).toEqual(['In Projects', 'did not finish'])
    expect(runFacts(run({ applied: false, state: 'dry-run', record: killed }))).toEqual([
      'In Projects',
    ])
    expect(runFacts(run({ record: record({ error: 'disk full' }) }))).toEqual([
      'In Projects',
      'stopped: disk full',
    ])
  })

  test('the command line that does the same', () => {
    expect(commandOf(run())).toBe('livesaver collect --apply')
    expect(commandOf(run({ applied: false }))).toBe('livesaver collect')
    expect(commandOf(run({ command: 'vst3' }))).toBe('livesaver plugins upgrade --apply')
    expect(commandOf(run({ command: 'reorg-plan', applied: false }))).toBe('livesaver reorg plan')
    expect(commandOf(run({ command: 'run-rename-tracks' }))).toBe(
      'livesaver run rename-tracks --apply',
    )
    expect(commandOf(run({ command: 'something-new', applied: false }))).toBe(
      'livesaver something-new',
    )
  })

  test('its options and its numbers in words; what was not set is left out', () => {
    const asked = run({
      record: record({
        options: {
          search: ['/music/Samples', '/Users/Shared'],
          ignore: [],
          exclude: [],
          packLimit: 50,
          matchLibraryPath: false,
          certainOnly: true,
          vendorLibraries: ['/Users/Shared'],
          sheet: false,
          into: '/music/Sorted',
          somethingNew: 7,
        },
        outcome: { sets: 21, written: 3, files: 12, bytes: 2_500_000, errors: 0, somethingNew: 4 },
      }),
    })
    expect(optionFacts(asked)).toEqual([
      { label: 'Sample folders', values: ['/music/Samples', '/Users/Shared'] },
      { label: 'Pack files', values: ['copied up to 50 MB'] },
      { label: 'Uncertain matches', values: ['left out'] },
      { label: 'Installed libraries', values: ['/Users/Shared'] },
      { label: 'Into', values: ['/music/Sorted'] },
      { label: 'somethingNew', values: ['7'] },
    ])
    expect(optionFacts(run({ record: record({ options: { packLimit: 0 } }) }))).toEqual([
      { label: 'Pack files', values: ['never copied'] },
    ])
    expect(outcomeFacts(asked)).toEqual([
      { label: 'Sets looked at', values: ['21'] },
      { label: 'Sets rewritten', values: ['3'] },
      { label: 'Files copied', values: ['12'] },
      { label: 'Size of the copies', values: ['2.5 MB'] },
      { label: 'Sets with an error', values: ['0'] },
      { label: 'somethingNew', values: ['4'] },
    ])
    expect([optionFacts(run()), outcomeFacts(run())]).toEqual([[], []])
  })
})

describe('what an undo of a run does', () => {
  test('is said for what the run did, in the singular where there is one', () => {
    expect(undoLines(run())).toEqual([
      '3 sets go back to what they were before the run, from the originals livesaver kept.',
      '12 copied files are moved to the Trash, unless another set uses them by now.',
      'What was changed since the run is left alone, and reported.',
    ])
    expect(undoLines(run({ sets: 1, files: 1 })).slice(0, 2)).toEqual([
      '1 set goes back to what it was before the run, from the originals livesaver kept.',
      '1 copied file is moved to the Trash, unless another set uses it by now.',
    ])
    expect(
      undoLines(run({ command: 'status', sets: 0, files: 0, tags: 3, comments: 2, ownFiles: 1 })),
    ).toEqual([
      'Finder tags and comments are set back to what they were.',
      '1 file of livesaver’s own is put back.',
      'What was changed since the run is left alone, and reported.',
    ])
    expect(undoLines(run({ command: 'reorg', sets: 0, files: 0, renames: 2 }))[0]).toBe(
      '2 files or folders that were moved go back to where they were.',
    )
  })
})

describe('when a run was', () => {
  const at = (day: number, hour = 12) =>
    run({
      id: `2026-10-0${day}_${hour}0000_collect_apply`,
      when: `2026-10-0${day} ${hour}:00:00`,
    })

  test('it started when it says, else when its folder is named', () => {
    expect(startedAt(at(3, 14))).toEqual(new Date(2026, 9, 3, 14))
    const noted = new Date(2026, 9, 2, 9, 15)
    expect(startedAt(run({ record: record({ started: noted.toISOString() }) }))).toEqual(noted)
    expect(startedAt(run({ when: '' }))).toBeUndefined()
    expect(moment(new Date(2026, 9, 3, 14, 30))).toBe('3 October 2026, 14:30')
    expect(moment(new Date(2026, 9, 3, 9, 5))).toBe('3 October 2026, 09:05')
    expect(moment(new Date(Number.NaN))).toBe('')
  })

  test('the runs are listed by day: today, yesterday, then by date', () => {
    const runs = [at(3, 14), at(3, 10), at(2), at(1), run({ id: 'old', when: '' })]
    const days = byDay(runs, new Date(2026, 9, 3, 18))
    expect(days.map((day) => [day.label, day.runs.length])).toEqual([
      ['Today', 2],
      ['Yesterday', 1],
      ['Thursday, 1 October 2026', 1],
      ['Some time ago', 1],
    ])
    expect(days[0]?.runs.map((r) => r.id)).toEqual([runs[0]?.id, runs[1]?.id] as string[])
    // Just after midnight, a run of the evening before was yesterday.
    expect(byDay([at(3, 23)], new Date(2026, 9, 4, 0, 5))[0]?.label).toBe('Yesterday')
    expect(byDay([])).toEqual([])
  })
})
