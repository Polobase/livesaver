/** What the web app asks of this computer: a check, a fix of all or of one project, an undo. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { copyFixtures, readSet, tempDir, writeFile } from '@livesaver/test-kit'
import { webCheck, webFix, webFolders, webInfo, webUndo } from '../src/web/local.js'
import type { WebEvent, WebFixed, WebRequest, WebResult } from '../src/web/protocol.js'

let tmp: { path: string; cleanup: () => void }
let projects: string
let samples: string
let settings: { config: string; force: true }
const saved = { home: process.env.LIVESAVER_HOME, trash: process.env.LIVESAVER_TRASH_DIR }

beforeEach(() => {
  tmp = tempDir()
  ;({ projects, samples } = copyFixtures(tmp.path))
  // livesaver's own state and the Trash of an undo lie in the temp folder, like everything else.
  process.env.LIVESAVER_HOME = join(tmp.path, 'home')
  process.env.LIVESAVER_TRASH_DIR = join(tmp.path, 'trash')
  const config = join(tmp.path, 'config.json')
  writeFileSync(
    config,
    JSON.stringify({
      userLibrary: join(tmp.path, 'Ableton', 'User Library'),
      factoryPacks: join(tmp.path, 'Ableton', 'Factory Packs'),
      appResources: '',
      vendorLibraries: [],
      searchRoots: [samples],
    }),
  )
  settings = { config, force: true }
})
afterEach(() => {
  tmp.cleanup()
  for (const [key, value] of [
    ['LIVESAVER_HOME', saved.home],
    ['LIVESAVER_TRASH_DIR', saved.trash],
  ] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

const request = (extra: Partial<WebRequest> = {}): WebRequest => ({
  projects: [projects],
  search: [{ path: samples, vendor: false }],
  options: { packLimitMB: 50, matchLibraryPath: false },
  ...extra,
})

async function check(req = request()): Promise<{ events: WebEvent[]; result: WebResult }> {
  const events: WebEvent[] = []
  await webCheck(req, (event) => events.push(event), settings)
  const last = events.at(-1)
  if (last?.type !== 'done') throw new Error(JSON.stringify(last))
  return { events, result: last.result }
}

async function fix(
  only?: string,
  req = request(),
): Promise<{ events: WebEvent[]; fixed: WebFixed }> {
  const events: WebEvent[] = []
  await webFix({ ...req, ...(only ? { only } : {}) }, (event) => events.push(event), settings)
  const last = events.at(-1)
  if (last?.type !== 'fixed') throw new Error(JSON.stringify(last))
  return { events, fixed: last.fixed }
}

const broken = () => join(projects, 'Brokenpath Project')
const setOf = (project: string) => join(project, 'Brokenpath.als')

describe('what the page starts with', () => {
  test('the settings of this computer, then the folders of the last check', async () => {
    const first = await webInfo(settings)
    expect(first.projects).toEqual([])
    expect(first.search).toEqual([{ path: samples, vendor: false, holds: [], exists: true }])
    expect(first.options).toEqual({ packLimitMB: 50, matchLibraryPath: false })

    const extra = join(tmp.path, 'Ableton')
    writeFile(join(extra, 'User Library', 'Samples', 'u.wav'), 'RIFF')
    await check(
      request({
        search: [
          { path: samples, vendor: true },
          { path: extra, vendor: false },
          { path: join(tmp.path, 'gone'), vendor: false },
        ],
        options: { packLimitMB: 20, matchLibraryPath: true },
      }),
    )
    const next = await webInfo(settings)
    expect(next.projects).toEqual([projects])
    expect(next.search).toEqual([
      { path: samples, vendor: true, holds: [], exists: true },
      { path: extra, vendor: false, holds: ['User Library', 'Factory Packs'], exists: true },
      { path: join(tmp.path, 'gone'), vendor: false, holds: [], exists: false },
    ])
    expect(next.options).toEqual({ packLimitMB: 20, matchLibraryPath: true })
  })

  test('the first time, the projects folder of the settings is offered as the one to check', async () => {
    writeFileSync(
      settings.config,
      JSON.stringify({ appResources: '', searchRoots: [samples], status: { projects } }),
    )
    expect((await webInfo(settings)).projects).toEqual([projects])
    writeFileSync(
      settings.config,
      JSON.stringify({ appResources: '', searchRoots: [samples], status: { projects: '/gone' } }),
    )
    expect((await webInfo(settings)).projects).toEqual([])
  })

  test('the folders of a folder, to choose one from', () => {
    writeFile(join(tmp.path, '.hidden', 'x'), '')
    writeFile(join(tmp.path, 'a file'), '')
    const listing = webFolders(tmp.path)
    expect(listing.path).toBe(tmp.path)
    expect(listing.folders.map((f) => f.name)).toEqual(['projects', 'samples'])
    expect(listing.folders[0]?.path).toBe(projects)
    expect(webFolders(projects).parent).toBe(tmp.path)
    expect(webFolders('/').parent).toBe('')
    expect(() => webFolders(join(tmp.path, 'nothing'))).toThrow()
  })
})

describe('a check on this computer', () => {
  test('says how far it is and ends with the result the page shows', async () => {
    const { events, result } = await check()
    expect(events.map((e) => e.type).filter((type) => type !== 'progress')).toEqual([
      'phase',
      'indexed',
      'phase',
      'phase',
      'done',
    ])
    expect(events.filter((e) => e.type === 'progress')).toHaveLength(3)
    expect([result.sets, result.completeSets, result.changingSets, result.copyFiles]).toEqual([
      3, 3, 1, 1,
    ])
    expect(result.projectRows.map((p) => [p.root, p.changes])).toEqual([
      [broken(), 1],
      [join(projects, 'Fixed Path Project'), 0],
      [join(projects, 'VST2toVST3 Project'), 0],
    ])
    expect(Object.keys(result.reports).sort()).toEqual([
      'changes.csv',
      'missing_samples.csv',
      'missing_sources.csv',
      'overview.md',
      'projects.csv',
    ])
    // Read-only: no run folder, nothing in the projects.
    expect(existsSync(join(tmp.path, 'home', 'runs'))).toBe(false)
    expect(existsSync(join(broken(), 'Samples'))).toBe(false)
  })

  test('a folder that is not there is said, not thrown', async () => {
    const events: WebEvent[] = []
    await webCheck(
      request({ projects: [join(tmp.path, 'nothing')] }),
      (e) => events.push(e),
      settings,
    )
    expect(events).toEqual([
      { type: 'failed', message: `This folder does not exist: ${join(tmp.path, 'nothing')}` },
    ])
  })
})

describe('a fix on this computer', () => {
  test('collects and rewrites like the command line, and undo takes it back', async () => {
    const original = readFileSync(setOf(broken()))
    const { events, fixed } = await fix()
    expect(events.map((e) => e.type).filter((type) => type !== 'progress')).toEqual([
      'phase',
      'indexed',
      'phase',
      'fixed',
    ])
    expect(fixed).toMatchObject({ sets: 1, files: 1, bytes: 2000324, errors: [] })
    expect(readSet(setOf(broken()))).toContain('Samples/Imported')
    expect(existsSync(join(broken(), 'Samples', 'Imported', '1.wav'))).toBe(true)
    expect(readdirSync(join(broken(), 'Backup'))).toHaveLength(1)
    expect((await check()).result.changingSets).toBe(0)

    // The page offers to undo the newest fix, also after a reload.
    expect((await webInfo(settings)).lastFix).toMatchObject({ run: fixed.run, sets: 1, files: 1 })
    const undone = await webUndo(fixed.run, settings)
    expect(undone).toEqual({ restored: 1, trashed: 2, kept: 0, changedSince: [], problems: [] })
    expect(readFileSync(setOf(broken())).equals(original)).toBe(true)
    expect(existsSync(join(broken(), 'Samples', 'Imported', '1.wav'))).toBe(false)
    expect((await check()).result.changingSets).toBe(1)
    expect((await webInfo(settings)).lastFix).toBeUndefined()
  })

  test('of one project leaves the others as they are, and still finds samples in them', async () => {
    const other = join(projects, 'Other Project')
    cpSync(broken(), other, { recursive: true })
    const before = readFileSync(setOf(other))
    // No sample folder at all: the sample is only in another project (the one Live fixed).
    const onlyProjects = request({ search: [] })
    const { fixed } = await fix(broken(), onlyProjects)
    expect(fixed).toMatchObject({ sets: 1, files: 1, errors: [] })
    expect(readSet(setOf(broken()))).toContain('Samples/Imported')
    expect(readFileSync(setOf(other)).equals(before)).toBe(true)
    const { result } = await check(onlyProjects)
    expect(result.projectRows.map((p) => [p.path, p.changes])).toEqual([
      ['Brokenpath Project', 0],
      ['Fixed Path Project', 0],
      ['Other Project', 1],
      ['VST2toVST3 Project', 0],
    ])
    expect(result.foundSources.map((s) => `${s.kind}: ${s.name}`)).toEqual([
      'Other project: Brokenpath Project',
    ])
  })

  test('refuses a folder outside the checked projects, and a run that is none', async () => {
    const events: WebEvent[] = []
    await webFix({ ...request(), only: samples }, (e) => events.push(e), settings)
    expect(events).toEqual([
      {
        type: 'failed',
        message: `This folder is not in a project folder that was checked: ${samples}`,
      },
    ])
    expect(webUndo('../x', settings)).rejects.toThrow('not a run')
    expect(webUndo('2026-01-01_000000_collect_apply', settings)).rejects.toThrow('not a run')
  })
})
