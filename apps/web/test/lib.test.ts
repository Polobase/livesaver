/** The app's own words and sums: states, plans, numbers, advice. */
import { describe, expect, test } from 'bun:test'
import type { ProjectRow, SetRow } from '@livesaver/ops'
import type { Scan } from '../src/engine/types.js'
import { olderSaves } from '../src/lib/detail.js'
import { bytes, count, percent, plural, seconds, splitPath, when } from '../src/lib/format.js'
import { projectHealth, setHealth, tally, whyLabel, whyText } from '../src/lib/health.js'
import { absentWords, LEAVE_OUT, leftOutWords, requestKey, wantedOf } from '../src/lib/library.js'
import { FREE_SPACE_MARGIN, fits, planOf } from '../src/lib/plan.js'
import { advance, starting } from '../src/lib/progress.js'
import { isReady, pageReadiness } from '../src/lib/ready.js'
import { adviceFor } from '../src/lib/words.js'

const set = (extra: Partial<SetRow> & { missing?: number } = {}): SetRow => ({
  path: 'A Project/A.als',
  project: 'A Project',
  name: 'A.als',
  live: '12.4.6',
  counts: {
    ok: 3,
    kept: 0,
    external: 0,
    found: 0,
    'not-found': extra.missing ?? 0,
    ambiguous: 0,
    mismatch: 0,
  },
  changes: 0,
  error: '',
  ...extra,
})

const project = (path: string, extra: Partial<ProjectRow> = {}): ProjectRow => ({
  root: `/music/${path}`,
  path,
  sets: 2,
  completeSets: 2,
  changingSets: 0,
  changes: 0,
  uncertain: 0,
  missing: 0,
  copyFiles: 0,
  copyBytes: 0,
  certain: { changingSets: 0, changes: 0, copyFiles: 0, copyBytes: 0 },
  errors: 0,
  ...extra,
})

describe('the state of a set and of a project', () => {
  test('missing wins over fixable: it is what a fix does not end', () => {
    expect(setHealth(set())).toBe('fine')
    expect(setHealth(set({ changes: 2 }))).toBe('fixable')
    expect(setHealth(set({ changes: 2, missing: 1 }))).toBe('missing')
    expect(setHealth(set({ error: 'unreadable: not gzip' }))).toBe('unreadable')
    expect(projectHealth(project('A'))).toBe('fine')
    expect(projectHealth(project('A', { changes: 1, changingSets: 1 }))).toBe('fixable')
    expect(projectHealth(project('A', { changes: 1, missing: 1 }))).toBe('missing')
    // A set that cannot be read says nothing about its samples.
    expect(projectHealth(project('A', { errors: 1 }))).toBe('unreadable')
    expect(projectHealth(project('A', { errors: 1, missing: 2 }))).toBe('missing')
  })

  test('a tally counts every row once', () => {
    const rows = [set(), set({ changes: 1 }), set({ missing: 2 }), set({ error: 'x' }), set()]
    expect(tally(rows, setHealth)).toEqual({ fine: 2, fixable: 1, missing: 1, unreadable: 1 })
  })
})

describe('old saves of a project', () => {
  test('are the incomplete sets an older Live saved than the newest of the project', () => {
    // A song saved by Live 9, then again and again by Live 11: only the first save has a gap.
    const song = [
      set({ live: '11.1.1' }),
      set({ live: '11.2.6' }),
      set({ live: '9.1.1', missing: 1 }),
    ]
    expect(olderSaves(song)).toEqual({ sets: 1, live: 9, newest: 11 })
    // A set that a fix would change is not complete either; one that is, is no trouble.
    expect(olderSaves([set({ live: '12.0' }), set({ live: '10.1', changes: 2 })])).toEqual({
      sets: 1,
      live: 10,
      newest: 12,
    })
    expect(olderSaves([set({ live: '12.0' }), set({ live: '9.7' })])).toBeUndefined()
    // The newest save itself is no old save, whatever it misses; nor is a set of no version.
    expect(olderSaves([set({ live: '11.0', missing: 1 }), set({ live: '9.7' })])).toBeUndefined()
    expect(olderSaves([set({ live: '12.0' }), set({ live: '', missing: 1 })])).toBeUndefined()
    expect(olderSaves([])).toBeUndefined()
  })
})

describe('what a fix would do', () => {
  const rows = [
    project('Both', {
      changingSets: 2,
      changes: 5,
      uncertain: 2,
      copyFiles: 3,
      copyBytes: 3000,
      certain: { changingSets: 1, changes: 3, copyFiles: 2, copyBytes: 2000 },
      missing: 1,
    }),
    project('Uncertain only', {
      changingSets: 1,
      changes: 1,
      uncertain: 1,
      copyFiles: 1,
      copyBytes: 500,
    }),
    project('Fine'),
  ]
  const scan = { samples: { projectRows: rows } } as unknown as Scan

  test('to all projects, and to chosen ones', () => {
    const all = planOf(scan, undefined, false)
    expect(all.projects.map((p) => p.path)).toEqual(['Both', 'Uncertain only'])
    expect([all.sets, all.changes, all.uncertain, all.copyFiles, all.copyBytes]).toEqual([
      3, 6, 3, 4, 3500,
    ])
    const one = planOf(scan, ['/music/Uncertain only'], false)
    expect([one.projects.length, one.sets, one.copyBytes]).toEqual([1, 1, 500])
    expect(planOf(scan, ['/music/Fine'], false).projects).toEqual([])
  })

  test('without the uncertain matches: fewer sets and copies, and more that stays missing', () => {
    const certain = planOf(scan, undefined, true)
    expect(certain.projects.map((p) => p.path)).toEqual(['Both'])
    expect([certain.sets, certain.changes, certain.uncertain]).toEqual([1, 3, 0])
    expect([certain.copyFiles, certain.copyBytes]).toEqual([2, 2000])
    // The three matches that are left out stay missing, beside the one that was missing anyway.
    expect([planOf(scan, undefined, false).missing, certain.missing]).toEqual([1, 4])
  })

  test('the copies must fit, with room to spare', () => {
    const plan = planOf(scan, undefined, false)
    expect(fits(plan, undefined)).toBeUndefined()
    expect(fits(plan, 3500 + FREE_SPACE_MARGIN)).toBe(true)
    expect(fits(plan, 3499 + FREE_SPACE_MARGIN)).toBe(false)
  })
})

describe('numbers, sizes and times', () => {
  test('are written the same everywhere', () => {
    expect([
      count(1234567),
      plural(1, 'set'),
      plural(2, 'set'),
      plural(2, 'library', 'libraries'),
    ]).toEqual(['1,234,567', '1 set', '2 sets', '2 libraries'])
    expect([bytes(999), bytes(2_000_324), bytes(1_940_000_000)]).toEqual([
      '999 bytes',
      '2.0 MB',
      '1.94 GB',
    ])
    expect([percent(0, 10), percent(1, 3000), percent(1, 20), percent(1, 3)]).toEqual([
      '0%',
      '<0.1%',
      '5.0%',
      '33%',
    ])
    expect([seconds(1.26), seconds(12.5), seconds(200)]).toEqual(['1.3 s', '13 s', '3 min'])
    expect(splitPath('Songs/A Project/A.als')).toEqual({ folder: 'Songs/A Project', name: 'A.als' })
    expect(splitPath('A.als')).toEqual({ folder: '', name: 'A.als' })
    expect(splitPath('E:\\Library\\Kick.wav')).toEqual({ folder: 'E:\\Library', name: 'Kick.wav' })
  })

  test('a time of today is a clock time, an older one has its day', () => {
    const now = new Date(2026, 9, 3, 16, 0)
    expect(when(new Date(2026, 9, 3, 14, 30).toISOString(), now)).toBe('14:30')
    expect(when(new Date(2026, 9, 1, 9, 5).toISOString(), now)).toBe('1 Oct, 09:05')
    expect(when('not a date', now)).toBe('')
  })
})

describe('how far a run is', () => {
  test('a new phase starts its count anew, the listed files stay', () => {
    let run = starting('indexing')
    run = advance(run, { type: 'indexed', files: 1200 })
    run = advance(run, { type: 'phase', phase: 'checking' })
    run = advance(run, { type: 'progress', done: 3, total: 10, name: 'A.als' })
    expect(run).toEqual({ phase: 'checking', files: 1200, done: 3, total: 10, name: 'A.als' })
    run = advance(run, { type: 'phase', phase: 'reporting' })
    expect([run.done, run.total, run.name, run.files]).toEqual([0, 0, '', 1200])
    expect(advance(run, { type: 'located', folders: [] })).toBe(run)
  })
})

describe('the library', () => {
  test('says what a complete scan still wants among the sample folders', () => {
    expect(wantedOf([])).toEqual({ libraries: true, live: true })
    expect(wantedOf([{ holds: ['User Library'] }])).toEqual({ libraries: false, live: true })
    expect(wantedOf([{ holds: ['Factory Packs'] }, { holds: ["Live's own content"] }])).toEqual({
      libraries: false,
      live: false,
    })
  })

  test('says which folders of the last visit are not there, before a scan and after one', () => {
    expect(absentWords(['Shared'], false)).toEqual({
      title: '1 folder from your last visit has to be added again',
      text: '“Shared”. A browser hands a page such a folder for one visit. Add it again, by the dialog or a drop: several folders can be dropped at once. Until then a scan does not read it: a sample that lies there counts as not found.',
      line: '1 folder from your last visit was not read by this scan: a sample that lies in it counts as not found.',
    })
    expect(absentWords(['Music', 'Shared'], true)).toEqual({
      title: 'This scan did not read 2 folders from your last visit',
      text: '“Music”, “Shared”. Samples that lie in them count as not found here. Let the page read them again (their rows say how), then scan again.',
      line: '2 folders from your last visit were not read by this scan: a sample that lies in them counts as not found.',
    })
    // A project folder among them: its sets are not scanned either.
    expect(absentWords(['Projects', 'Shared'], true, true).text).toBe(
      '“Projects”, “Shared”. Samples that lie in them count as not found here, and sets in them are not checked. Let the page read them again (their rows say how), then scan again.',
    )
    expect(absentWords(['Projects'], false, true).text).toContain(
      'Until then a scan does not read it: a sample that lies there counts as not found, and sets in it are not checked.',
    )
  })

  test('says which sets a scan left out for the Live that saved them', () => {
    // The option is the oldest version that is still checked.
    expect(LEAVE_OUT.map((choice) => [choice.value, choice.label])).toEqual([
      [0, 'Check every set'],
      [10, 'Leave out Live 9 and older'],
      [11, 'Leave out Live 10 and older'],
      [12, 'Leave out Live 11 and older'],
    ])
    expect(leftOutWords(0, 10)).toBe('')
    expect(leftOutWords(1, 10)).toBe('1 set saved with Live 9 or older is left out, as you set.')
    expect(leftOutWords(1234, 12)).toBe(
      '1,234 sets saved with Live 11 or older are left out, as you set.',
    )
    // (A scan of a livesaver that does not say what it was asked.)
    expect(leftOutWords(2, undefined)).toBe(
      '2 sets saved with an older Live are left out, as you set.',
    )
  })

  test('two requests are the same scan if folders, their marks and the options are', () => {
    const request = {
      projects: [{ id: 'p', path: '/p', name: 'p', vendor: false }],
      search: [{ id: 's', path: '/s', name: 's', vendor: false }],
      options: { packLimitMB: 50, matchLibraryPath: false },
    }
    expect(requestKey(request)).toBe(requestKey(structuredClone(request)))
    const marked = {
      ...request,
      search: [{ ...request.search[0], id: 's', path: '/s', vendor: true }],
    }
    expect(requestKey(marked)).not.toBe(requestKey(request))
    const other = { ...request, options: { ...request.options, matchLibraryPath: true } }
    expect(requestKey(other)).not.toBe(requestKey(request))
  })
})

describe('advice for missing samples', () => {
  test('is said in the app’s terms, and knows when a folder is what helps', () => {
    expect(adviceFor({ advice: 'folder', hint: 'pass it with --search' })).toEqual({
      text: 'Find this folder or drive and add it as a sample folder.',
      addFolder: true,
      accept: false,
    })
    expect(adviceFor({ advice: 'pack', hint: '' }).addFolder).toBe(false)
    // A source without a known kind keeps the words it came with.
    expect(adviceFor({ advice: '', hint: 'as it came' })).toEqual({
      text: 'as it came',
      addFolder: false,
      accept: false,
    })
  })

  test('a library that is installed in another version is not something to install', () => {
    const expansion = { advice: 'ni-expansion' as const, hint: '' }
    expect(adviceFor({ ...expansion, samples: 64, inLibrary: 0 })).toMatchObject({
      text: 'Install it in Native Access if it is in your Native Instruments account, then scan again.',
      accept: false,
    })
    expect(adviceFor({ ...expansion, samples: 64, inLibrary: 64 })).toEqual({
      text: 'It is installed, in another version than your sets remember: its vendor re-saved these files, so their fingerprints differ.',
      addFolder: false,
      accept: true,
    })
    // In part: what is there is taken, and the rest is still to get.
    expect(adviceFor({ ...expansion, samples: 64, inLibrary: 40 })).toEqual({
      text: '40 of these are in the library as it is installed now, re-saved by its vendor. The rest: Install it in Native Access if it is in your Native Instruments account, then scan again.',
      addFolder: false,
      accept: true,
    })
    expect(adviceFor({ advice: 'folder', hint: '', samples: 3, inLibrary: 1 })).toMatchObject({
      text: '1 of these is in the library as it is installed now, re-saved by its vendor. The rest: Find this folder or drive and add it as a sample folder.',
      addFolder: true,
    })
    // A livesaver from before it said so says nothing of it.
    expect(adviceFor(expansion).accept).toBe(false)
  })
})

describe('a sample the browser kept the page from', () => {
  test('says so in its row, and is no sample to go and look for', () => {
    expect(whyLabel({ status: 'not-found', blind: '' })).toBe('Not found')
    expect(whyLabel({ status: 'mismatch' })).toBe('Different content')
    expect(
      (['unseen', 'unmade', 'locked'] as const).map((blind) =>
        whyLabel({ status: 'not-found', blind }),
      ),
    ).toEqual(['Hidden by browser', 'Found, not copied', 'Found, set locked'])
    expect(whyText({ status: 'not-found' })).toBe(
      'No file of this name is in the folders that were searched.',
    )
    expect(whyText({ status: 'not-found', blind: 'unseen' })).toContain(
      'The file may well be there, so no other file is taken for it.',
    )
    // What helps is the folder that shows every name; the other two need livesaver itself.
    expect(adviceFor({ advice: 'unseen', hint: '' })).toMatchObject({
      addFolder: true,
      accept: false,
    })
    expect(adviceFor({ advice: 'unseen', hint: '' }).text).toContain(
      'Drop your project folder onto the sample folders as well: a dropped folder shows every name.',
    )
    for (const advice of ['unmade', 'locked'] as const) {
      expect(adviceFor({ advice, hint: '' }).addFolder).toBe(false)
      expect(adviceFor({ advice, hint: '' }).text).toContain('livesaver on your computer')
    }
  })
})

describe('what a fix in a browser needs before it starts', () => {
  const folder = (id: string, extra: object = {}) => ({
    id,
    name: id,
    path: '',
    vendor: false,
    holds: [] as string[],
    exists: true,
    ...extra,
  })
  const scanned = {
    projects: [folder('Projects'), folder('Old Projects')],
    search: [folder('Samples'), folder('Ableton'), folder('Live')],
    options: { packLimitMB: 50, matchLibraryPath: false },
  }
  const placed = (how: Record<string, 'typed' | 'found' | 'unknown'>) => ({
    folders: Object.entries(how).map(([id, value]) => ({ id, path: `/${id}`, how: value })),
  })

  test('the page may edit every project folder, and knows where the folders lie that sets will name', () => {
    const library = {
      projects: [
        folder('Projects', { access: 'edit' }),
        folder('Old Projects', { access: 'edit' }),
      ],
      search: [
        folder('Samples'),
        folder('Ableton', { holds: ['User Library', 'Factory Packs'] }),
        folder('Live', { holds: ["Live's own content"] }),
      ],
    }
    const all = placed({
      Projects: 'found',
      'Old Projects': 'typed',
      // A plain sample folder needs no place: its files are copied, and no set names it.
      Samples: 'unknown',
      Ableton: 'typed',
      Live: 'found',
    })
    const ready = pageReadiness(scanned, all, library)
    expect(ready).toEqual({
      ask: [],
      readOnly: [],
      unplaced: [],
      // Where the folders lie that a fix names in the sets is shown, to be looked at: the
      // project folders, and Ableton's own.
      places: [
        { id: 'Projects', name: 'Projects', path: '/Projects', how: 'found' },
        { id: 'Old Projects', name: 'Old Projects', path: '/Old Projects', how: 'typed' },
        { id: 'Ableton', name: 'Ableton', path: '/Ableton', how: 'typed' },
        { id: 'Live', name: 'Live', path: '/Live', how: 'found' },
      ],
    })
    expect(isReady(ready)).toBe(true)

    // A project folder, the packs and Live's own content are named in sets: they need a place.
    const nowhere = placed({
      Projects: 'unknown',
      'Old Projects': 'found',
      Samples: 'unknown',
      Ableton: 'unknown',
      Live: 'unknown',
    })
    expect(pageReadiness(scanned, nowhere, library).unplaced).toEqual([
      'Projects',
      'Ableton',
      'Live',
    ])
    expect(isReady(pageReadiness(scanned, nowhere, library))).toBe(false)
  })

  test('a project folder that can only be read is to be allowed, or added again', () => {
    const library = {
      // One was dropped (the browser can be asked), one uploaded; a folder that was removed
      // since the scan is not there to be edited at all.
      projects: [folder('Projects', { access: 'ask' })],
      search: [],
    }
    const ready = pageReadiness(scanned, placed({ Projects: 'found' }), library)
    expect(ready.ask).toEqual([{ id: 'Projects', name: 'Projects' }])
    expect(ready.readOnly).toEqual(['Old Projects'])
    expect(isReady(ready)).toBe(false)
    const uploaded = { projects: [folder('Projects', { access: 'read' })], search: [] }
    expect(pageReadiness(scanned, placed({}), uploaded).readOnly).toEqual([
      'Projects',
      'Old Projects',
    ])
  })
})
