/** The rating sheet (Ratings.csv). */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  csvLine,
  csvRecords,
  decodeTags,
  EMPTY_REMAP,
  encodeTags,
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
  tempDir,
  writeFile,
  writeSet,
} from '@livesaver/test-kit'
import {
  DEFAULT_PROFILE,
  type EnvConfig,
  parseDecision,
  parseStars,
  statusRun,
  typedCells,
} from '../src/index.js'

const PROFILE = DEFAULT_PROFILE
const xattr = createXattr()
const onMac = process.platform === 'darwin' ? describe : describe.skip

describe('parsing (ParseTest)', () => {
  test('decisions may be abbreviated', () => {
    const decisions = PROFILE.decisions.map((d) => d.name)
    const cases: Record<string, string | undefined> = {
      c: 'Continue',
      Cont: 'Continue',
      l: 'Later',
      do: 'Done',
      DE: 'Delete',
      ar: 'Archive',
      s: 'Salvage',
      '': '',
      d: undefined,
      maybe: undefined,
    }
    for (const [text, want] of Object.entries(cases))
      expect([text, parseDecision(text, decisions)]).toEqual([text, want])
  })

  test('decisions ignore accents', () => {
    expect(parseDecision('cafe', ['Café', 'Done'])).toBe('Café')
    expect(parseDecision('CAFÉ', ['Cafe\u0301', 'Done'])).toBe('Cafe\u0301')
  })

  test('stars', () => {
    const cases: Record<string, string | undefined> = {
      '4': '4★',
      '4★': '4★',
      '***': '3★',
      '2 stars': '2★',
      '5,0': '5★',
      '': '',
      '6': undefined,
      good: undefined,
    }
    for (const [text, want] of Object.entries(cases))
      expect([text, parseStars(text)]).toEqual([text, want])
  })

  test('typed cells are those that differ from the last export', () => {
    const snapshot = new Map([['Projects/A Project', { decision: 'Later', stars: '', note: '' }]])
    const current = new Map([
      ['Projects/A Project', { decision: 'Later', stars: '3', note: '' }],
      ['Projects/B Project', { decision: '', stars: '', note: 'new' }],
    ])
    expect(Object.fromEntries(typedCells(current, snapshot))).toEqual({
      'Projects/A Project': { stars: '3' },
      'Projects/B Project': { note: 'new' },
    })
  })
})

async function readTags(path: string): Promise<Tag[]> {
  return decodeTags(await xattr?.get(path, TAGS_ATTR))
}

const ENV: EnvConfig = {
  userLibrary: '',
  factoryPacks: '',
  appResources: '',
  preferredRoots: [],
  vendorLibraries: [],
  remap: EMPTY_REMAP,
}

onMac('the sheet in status runs (SheetRunTest)', () => {
  let tmp: { path: string; cleanup: () => void }
  let projects: string
  let song: string
  let loop: string
  let sheet: string
  let snapshotPath: string
  let fake: ReturnType<typeof fakeOsascript>

  beforeEach(() => {
    tmp = tempDir()
    projects = join(tmp.path, 'Projects')
    song = makeProject(join(projects, 'Remixes'), 'Song')
    writeSet(join(song, 'Song.als'), liveSet(arranged(12, 8, 10)))
    loop = makeProject(join(projects, 'Studio'), 'Loop')
    writeSet(join(loop, 'Loop.als'), liveSet(midiTrack({ session: [midiClip(0, 4)] })))
    sheet = join(tmp.path, 'Ratings.csv')
    snapshotPath = join(tmp.path, '.cache', 'ratings.json')
    fake = fakeOsascript()
  })
  afterEach(() => tmp.cleanup())

  const runStatus = async (apply = true) => {
    const host = createNodeHost({
      write: apply,
      trashDir: join(tmp.path, 'Trash'),
      finder: new FinderScriptComments(fake.runner),
    })
    const r = await statusRun(host, {
      targets: [projects],
      apply,
      env: ENV,
      inventory: new Inventory([]),
      exportsDir: '',
      profile: PROFILE,
      sheet: { path: sheet, snapshot: snapshotPath },
    })
    return r.outcome
  }
  const rows = () => csvRecords(readFileSync(sheet, 'utf8')).records
  const header = () => csvRecords(readFileSync(sheet, 'utf8')).header

  /** Change cells like a spreadsheet program would, saved with `delimiter`. */
  const edit = (project: string, cells: Record<string, string>, delimiter = ',') => {
    const cols = header()
    const records = rows()
    for (const r of records) if (r.Project === project) Object.assign(r, cells)
    const text = [cols, ...records.map((r) => cols.map((c) => r[c] ?? ''))]
      .map((row) => csvLine(row, delimiter))
      .join('')
    writeFileSync(sheet, text)
  }

  test('the first run writes the sheet, furthest projects first', async () => {
    const outcome = await runStatus()
    expect(outcome.sheetWritten).toBe(sheet)
    expect(rows().map((r) => [r.Group, r.Project, r.Progress])).toEqual([
      ['Projects/Remixes', 'Song Project', 'Elaborated'],
      ['Projects/Studio', 'Loop Project', 'Session only'],
    ])
    expect(header().slice(0, 5)).toEqual(['Group', 'Project', 'Decision', 'Stars', 'Note'])
  })

  test('typed cells become tags and the note', async () => {
    await runStatus()
    edit('Song Project', { Decision: 'c', Stars: '4', Note: 'Drop!' }, ';')
    const outcome = await runStatus()
    expect(outcome.taken).toEqual([
      'Projects/Remixes/Song Project: decision Continue, stars 4★, note',
    ])
    expect(outcome.tagsChanged).toEqual([song])
    expect((await readTags(song)).slice(0, 2)).toEqual([
      ['Continue', 2],
      ['4★', 0],
    ])
    expect(fake.comments.get(song)?.endsWith(' ‖ Drop!')).toBe(true)
    const row = rows()[0]
    expect([row?.Decision, row?.Stars, row?.Note]).toEqual(['Continue', '4★', 'Drop!'])
    // nothing typed since: a second run takes nothing over
    expect((await runStatus()).taken).toEqual([])
  })

  test('a tag set in Finder wins over an unchanged sheet', async () => {
    await runStatus()
    edit('Song Project', { Decision: 'Later' })
    await runStatus()
    const tags = (await readTags(song)).filter(([n]) => n !== 'Later')
    await xattr?.set(song, TAGS_ATTR, encodeTags([['Archive', 1], ...tags]))
    const outcome = await runStatus()
    expect(outcome.taken).toEqual([])
    expect(rows()[0]?.Decision).toBe('Archive')
    expect(await readTags(song)).toContainEqual(['Archive', 1])
  })

  test('clearing a cell removes the tag and the note', async () => {
    await runStatus()
    edit('Loop Project', { Decision: 'Delete', Note: 'just a loop' })
    await runStatus()
    edit('Loop Project', { Decision: '', Note: '' })
    await runStatus()
    const decisions = new Set(PROFILE.decisions.map((d) => d.name))
    expect((await readTags(loop)).filter(([n]) => decisions.has(n))).toEqual([])
    expect(fake.comments.get(loop)).not.toContain('‖')
  })

  test('an unclear value keeps the sheet', async () => {
    await runStatus()
    edit('Song Project', { Decision: 'd', Stars: '5' })
    const outcome = await runStatus()
    expect(outcome.sheetProblems[0]).toContain('decision “d” unclear')
    expect(outcome.sheetSkipped).toContain('not everything was taken over')
    expect(rows()[0]?.Decision).toBe('d') // your entry stays for correcting it
    expect(await readTags(song)).toContainEqual(['5★', 0]) // the clear part is taken over
  })

  test('a dry run touches neither sheet nor tags', async () => {
    await runStatus()
    edit('Song Project', { Decision: 'Done' })
    const before = readFileSync(sheet)
    const outcome = await runStatus(false)
    expect(outcome.taken).toEqual(['Projects/Remixes/Song Project: decision Done'])
    expect(readFileSync(sheet)).toEqual(before)
    expect((await readTags(song)).map(([n]) => n)).not.toContain('Done')
  })

  test('a moved project is found by its folder name', async () => {
    await runStatus()
    edit('Song Project', { Decision: 'Continue' })
    const moved = join(projects, '1 In Progress', 'Song Project')
    mkdirSync(dirname(moved), { recursive: true })
    renameSync(song, moved)
    const outcome = await runStatus()
    expect(outcome.sheetProblems).toEqual([])
    expect(await readTags(moved)).toContainEqual(['Continue', 2])
    expect(rows().map((r) => [r.Group, r.Project])).toContainEqual([
      'Projects/1 In Progress',
      'Song Project',
    ])
  })

  test('a deleted project drops its row', async () => {
    await runStatus()
    edit('Loop Project', { Decision: 'Delete', Note: 'is deleted' })
    rmSync(loop, { recursive: true })
    const outcome = await runStatus()
    expect(outcome.sheetProblems).toEqual([])
    expect(outcome.sheetNotes).toEqual([
      'Projects/Studio/Loop Project: project no longer exists, row dropped',
    ])
    expect(rows().map((r) => r.Project)).toEqual(['Song Project'])
  })

  test('a changed project name in the sheet is a problem', async () => {
    await runStatus()
    edit('Loop Project', { Project: 'Looop Project', Decision: 'Later' })
    const outcome = await runStatus()
    expect(outcome.sheetProblems[0]).toContain('project not found')
    expect(outcome.sheetSkipped).toContain('not everything was taken over')
  })

  test('a sheet open in LibreOffice is left alone', async () => {
    await runStatus()
    edit('Song Project', { Decision: 'Done' })
    writeFile(join(tmp.path, '.~lock.Ratings.csv#'), 'lock')
    const outcome = await runStatus()
    expect(outcome.sheetSkipped).toContain('the sheet is open')
    expect(outcome.taken).toEqual([])
    expect(rows()[0]?.Decision).toBe('Done')
  })
})
