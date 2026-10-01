/** status with the German profile: stages, tags, comments, reports. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  csvRecords,
  decodeTags,
  EMPTY_REMAP,
  encodeTags,
  makeSetInfo,
  type SetMeasures,
  TAGS_ATTR,
  type Tag,
} from '@livesaver/core'
import { createNodeHost, createXattr, FinderScriptComments } from '@livesaver/node'
import { Inventory } from '@livesaver/plugins'
import {
  arranged,
  clipsTrack,
  fakeOsascript,
  KICKSTART,
  liveSet,
  makeProject,
  midiClip,
  midiTrack,
  SERUM,
  sampleClip,
  snapshot,
  tempDir,
  writeFile,
  writeSet,
} from '@livesaver/test-kit'
import {
  chooseMain,
  compareSets,
  customProfile,
  DEFAULT_PROFILE,
  type EnvConfig,
  findExports,
  mergeComment,
  type ProjectStatus,
  type SetStatus,
  songKey,
  splitComment,
  stageOf,
  statusRun,
  statusSummary,
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

const info = (values: Partial<SetMeasures> = {}) => makeSetInfo(values)

function setStatus(path: string, root: string, values: Partial<SetStatus> = {}): SetStatus {
  return {
    path,
    root,
    mtime: 0,
    info: undefined,
    error: '',
    missingSamples: [],
    missingDevices: [],
    plugins: new Map(),
    exports: [],
    ...values,
  }
}

describe('stages (StageTest)', () => {
  test('thresholds', () => {
    expect(stageOf(info(), PROFILE)).toBe('empty')
    expect(stageOf(info({ sessionClips: 3 }), PROFILE)).toBe('session')
    expect(stageOf(info({ arrangementClips: 4, end: 32, distinctBlocks: 6 }), PROFILE)).toBe(
      'sketch',
    ) // 16 s
    expect(stageOf(info({ arrangementClips: 4, end: 512, distinctBlocks: 5 }), PROFILE)).toBe(
      'sketch',
    ) // loop stretched
    expect(stageOf(info({ arrangementClips: 4, end: 512, distinctBlocks: 6 }), PROFILE)).toBe(
      'arranged',
    )
    expect(
      stageOf(info({ arrangementClips: 4, end: 512, distinctBlocks: 12, automated: 9 }), PROFILE),
    ).toBe('arranged')
    expect(
      stageOf(info({ arrangementClips: 4, end: 512, distinctBlocks: 12, automated: 10 }), PROFILE),
    ).toBe('elaborated')
  })

  test('the main set got furthest', () => {
    const s = (name: string, mtime: number, values: Partial<SetMeasures>) =>
      setStatus(`/p/${name}.als`, '/p', { mtime, info: info(values) })
    const loop = s('Loop', 3, { sessionClips: 4 })
    const short = s('Short', 1, { arrangementClips: 5, end: 512, distinctBlocks: 8 })
    const long = s('Long', 2, { arrangementClips: 5, end: 640, distinctBlocks: 8 })
    expect(chooseMain([loop, short, long], PROFILE)).toBe(long)
    const newer = s('Newer', 5, { arrangementClips: 5, end: 640, distinctBlocks: 8 })
    expect(chooseMain([loop, short, long, newer], PROFILE)).toBe(newer)
    expect(chooseMain([], PROFILE)).toBeUndefined()
  })
})

describe('comments (CommentTest)', () => {
  const AUTO = 'Sketch · 1:20 · 124 BPM · 8 tracks · Live 12.4 · complete'

  test('notes after the separator stay', () => {
    expect(mergeComment('', AUTO, PROFILE)).toBe(AUTO)
    expect(mergeComment('Arranged · 5:00 · old', AUTO, PROFILE)).toBe(AUTO)
    expect(mergeComment('Arranged · 5:00 ‖ new drop', AUTO, PROFILE)).toBe(`${AUTO} ‖ new drop`)
    expect(mergeComment('‖ new drop', AUTO, PROFILE)).toBe(`${AUTO} ‖ new drop`)
  })

  test('own text without separator is kept as a note', () => {
    expect(mergeComment('Sketch I like', AUTO, PROFILE)).toBe(`${AUTO} ‖ Sketch I like`)
    expect(mergeComment('Hook! ‖ vocals missing', AUTO, PROFILE)).toBe(
      `${AUTO} ‖ Hook! vocals missing`,
    )
    expect(splitComment(`${AUTO} ‖ x`, PROFILE)).toEqual([AUTO, 'x'])
  })

  test('names from the config file', () => {
    const own = customProfile(PROFILE, { stages: { sketch: 'Draft' }, error: 'Broken' })
    expect(mergeComment('Draft · 1:00 ‖ my idea', AUTO, own)).toBe(`${AUTO} ‖ my idea`)
    expect(mergeComment('Broken · unreadable: x', AUTO, own)).toBe(AUTO)
    expect(mergeComment('Sketch · 1:00', AUTO, own)).toBe(`${AUTO} ‖ Sketch · 1:00`)
  })

  test('song names and copies', () => {
    expect(songKey('/a/First Try Project copy')).toBe('first try')
    expect(songKey('/a/First Try Project')).toBe('first try')
    expect(songKey('/a/Night Drive copy 2')).toBe('night drive')
  })

  test('compare copies', () => {
    const s = (name: string, content: string) =>
      setStatus(`/p/${name}.als`, '/p', { info: info({ contentHash: content }) })
    expect(compareSets([s('A', '1'), s('B', '2')], [s('A', '1'), s('B', '2')])).toBe(
      'all sets equal',
    )
    expect(
      compareSets([s('A', '1'), s('B', '2'), s('C', '3')], [s('A', '1'), s('B', 'x'), s('D', '4')]),
    ).toBe('1 same, 1 different, 1 only here, 1 only there')
  })
})

async function readTags(path: string): Promise<Tag[]> {
  return decodeTags(await xattr?.get(path, TAGS_ATTR))
}

onMac('runs (RunTest)', () => {
  let tmp: { path: string; cleanup: () => void }
  let projects: string
  let exports: string
  let song: string
  let mainSet: string
  let loopSet: string
  const inventory = new Inventory([
    { format: 'VST2', ident: '1483109208', name: 'Serum', path: '', native: false, scanned: true },
  ])

  beforeEach(() => {
    tmp = tempDir()
    projects = join(tmp.path, 'Projects')
    exports = join(tmp.path, 'Exports')
    const kick = writeFile(join(tmp.path, 'Samples', 'Kick.wav'), 'RIFF')
    // Remixes/Song: an elaborated main set with a missing sample, and a loop sketch
    song = makeProject(join(projects, 'Remixes'), 'Song')
    mainSet = join(song, 'Song 2.als')
    writeSet(
      mainSet,
      liveSet(arranged(12, 8, 10) + clipsTrack([sampleClip(kick), sampleClip('/gone/Snare.wav')]), {
        plugins: SERUM,
      }),
    )
    loopSet = join(song, 'Song.als')
    writeSet(loopSet, liveSet(midiTrack({ session: [midiClip(0, 4)] }), { plugins: KICKSTART }))
    // Studio/Song: the same music again
    const copy = makeProject(join(projects, 'Studio'), 'Song')
    writeSet(
      join(copy, 'Song 2.als'),
      liveSet(arranged(12, 8, 10) + clipsTrack([sampleClip(kick), sampleClip('/gone/Snare.wav')]), {
        plugins: SERUM,
      }),
    )
    writeFile(join(exports, 'Song 2.wav'), 'RIFF')
  })
  afterEach(() => tmp.cleanup())

  const runStatus = async (apply: boolean, fake = fakeOsascript(), comments = true) => {
    const host = createNodeHost({
      write: apply,
      trashDir: join(tmp.path, 'Trash'),
      finder: new FinderScriptComments(fake.runner),
    })
    return statusRun(host, {
      targets: [projects],
      apply,
      env: ENV,
      inventory,
      exportsDir: exports,
      profile: PROFILE,
      comments,
    })
  }
  const rows = (reports: Map<string, string>, name: string) =>
    csvRecords(reports.get(name) as string).records

  test('a dry run changes nothing', async () => {
    const before = snapshot(projects)
    const fake = fakeOsascript()
    const r = await runStatus(false, fake)
    expect(snapshot(projects)).toEqual(before)
    expect(fake.calls).toEqual([]) // Finder is not even asked
    expect(await readTags(song)).toEqual([])
    expect(r.outcome.tagsChanged).toHaveLength(5)
    const sets = Object.fromEntries(
      rows(r.reports, 'sets.csv')
        .filter((x) => x.Project === 'Remixes/Song Project')
        .map((x) => [x.Set, x]),
    )
    expect(sets['Song 2.als']?.Progress).toBe('Elaborated')
    expect(sets['Song 2.als']?.Tags).toBe('Elaborated, Samples missing, Rosetta, Export')
    expect(sets['Song 2.als']?.Comment).toBe(
      'Elaborated · 3:12 · 120 BPM · 13 tracks · Live 12.4 · missing: 1 sample · Rosetta: Serum (VST2) · Export',
    )
    expect(sets['Song.als']?.Comment).toBe(
      'Session only · 1 clip in 1 scene · 120 BPM · 1 track · Live 12.4 · missing: Kickstart-64bit',
    )
  })

  test("apply marks sets and folders and keeps the user's tags and notes", async () => {
    await xattr?.set(
      song,
      TAGS_ATTR,
      encodeTags([
        ['Continue', 2],
        ['4★', 0],
      ]),
    )
    const fake = fakeOsascript({ [song]: 'hook in the drop' })
    const r = await runStatus(true, fake)
    expect(r.outcome.commentError).toBe('')
    expect(await readTags(loopSet)).toEqual([
      ['Session only', 0],
      ['Plugins missing', 7],
    ])
    expect(await readTags(song)).toEqual([
      ['Continue', 2],
      ['4★', 0],
      ['Elaborated', 0],
      ['Samples missing', 7],
      ['Rosetta', 0],
      ['Export', 0],
      ['Duplicate', 0],
    ])
    expect(fake.comments.get(song)).toBe(
      'Elaborated · main set “Song 2” 3:12 · 2 sets · missing: 1 sample · Rosetta: Serum (VST2) · ' +
        'also in Studio (1 same, 1 only here) · Export: Song 2.wav ‖ hook in the drop',
    )
    expect(fake.comments.get(mainSet)?.split(' · ')[0]).toBe('Elaborated')
    const row = rows(r.reports, 'projects.csv').find((x) => x.Group === 'Remixes')
    expect([row?.Decision, row?.Stars, row?.Note]).toEqual(['Continue', '4★', 'hook in the drop'])

    // a second run finds nothing to do
    const again = await runStatus(true, fake)
    expect([again.outcome.tagsChanged, again.outcome.commentsChanged]).toEqual([[], []])
  })

  test('tags only', async () => {
    const fake = fakeOsascript()
    const r = await runStatus(true, fake, false)
    expect(fake.calls).toEqual([])
    expect(r.outcome.commentsChanged).toEqual([])
    expect(await readTags(loopSet)).toContainEqual(['Session only', 0])
  })

  test('without Finder permission the tags are still set', async () => {
    const fake = fakeOsascript(
      {},
      'execution error: Not authorized to send Apple events to Finder. (-1743)',
    )
    const r = await runStatus(true, fake)
    expect(r.outcome.commentError).toContain('no permission to control Finder')
    expect(await readTags(mainSet)).toContainEqual(['Elaborated', 0])
    expect(statusSummary(r.projects, r.outcome, true, true, PROFILE)).toContain('COMMENTS NOT SET')
  })

  test('a folder without project marker gets no tags', async () => {
    const loose = join(projects, 'Loose.als')
    writeSet(loose, liveSet(midiTrack({ session: [midiClip(0, 4)] })))
    await runStatus(true)
    expect(await readTags(projects)).toEqual([])
    expect(await readTags(loose)).toEqual([
      ['Session only', 0],
      ['Complete', 0],
    ])
  })

  test('decomposed file names do not change the comment every time', async () => {
    // Finder hands out decomposed names (NFD); the comment uses composed ones (NFC)
    const root = makeProject(join(projects, 'Old'), 'Cafe\u0301 Noir')
    writeSet(join(root, 'Cafe\u0301 Noir.als'), liveSet(midiTrack({ session: [midiClip(0, 4)] })))
    const fake = fakeOsascript()
    await runStatus(true, fake)
    expect(fake.comments.get(root)).toBe(
      'Session only · main set “Caf\u00e9 Noir” · 1 set · complete',
    )
    const again = await runStatus(true, fake)
    expect(again.outcome.commentsChanged).toEqual([])
  })

  test('an unreadable set', async () => {
    const broken = writeFile(join(song, 'Broken.als'), 'not gzip, not xml')
    const r = await runStatus(true)
    expect(await readTags(broken)).toEqual([])
    const row = rows(r.reports, 'sets.csv').find((x) => x.Set === 'Broken.als')
    expect(row?.Error?.startsWith('unreadable')).toBe(true)
    expect(row?.Comment?.startsWith('Error · unreadable')).toBe(true)
  })
})

describe('exports (ExportTest)', () => {
  test('mixdowns named like the song', async () => {
    const tmp = tempDir()
    try {
      const root = makeProject(tmp.path, 'Anthem')
      const own = writeFile(join(root, 'Anthem 3.wav'), 'RIFF')
      writeFile(join(root, 'Kick.wav'), 'RIFF')
      const exportsDir = join(tmp.path, 'Exports')
      const shared = writeFile(join(exportsDir, 'Anthem 117.wav'), 'RIFF')
      writeFile(join(exportsDir, 'Anthemx.wav'), 'RIFF')
      const s = setStatus(join(root, 'Anthem 3.als'), root, { info: info() })
      const project: ProjectStatus = {
        root,
        sets: [s],
        isProject: true,
        main: undefined,
        exports: [],
        duplicates: [],
        size: 0,
        tags: [],
      }
      await findExports(createNodeHost(), [project], exportsDir)
      expect(s.exports).toEqual([own])
      expect(project.exports).toEqual([own, shared].sort())
    } finally {
      tmp.cleanup()
    }
  })
})
