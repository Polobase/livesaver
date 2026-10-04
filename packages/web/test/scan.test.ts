/** A scan in a page: locating folders, checking sets, the plug-ins, shaping the result. */

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cpSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { CORE_LIBRARY_PACK_ID, REL_PACK } from '@livesaver/core'
import type { CheckView } from '@livesaver/ops'
import {
  copyFixtures,
  deviceSet,
  makeProject,
  pickedFolder,
  tempDir,
  uploadedFolder,
  writeFile,
  writeSet,
} from '@livesaver/test-kit'
import { type BrowserScan, type FolderInput, type ScanEvent, scanFolders } from '../src/index.js'

let tmp: { path: string; cleanup: () => void }
let projects: string
let samples: string
beforeEach(() => {
  tmp = tempDir()
  ;({ projects, samples } = copyFixtures(tmp.path))
})
afterEach(() => tmp.cleanup())

const folder = (id: string, source: FolderInput['source'], extra: Partial<FolderInput> = {}) => ({
  id,
  source,
  path: '',
  vendor: false,
  ...extra,
})

/** The samples of a scan with what the page is told beside them, as one result. */
type Result = CheckView & Pick<BrowserScan, 'folders' | 'reports' | 'ableton'>

async function check(
  projectFolders: FolderInput[],
  search: FolderInput[],
  matchLibraryPath = false,
): Promise<{ events: ScanEvent[]; result: Result; scan: BrowserScan }> {
  const events: ScanEvent[] = []
  await scanFolders(
    { projects: projectFolders, search, options: { packLimitMB: 50, matchLibraryPath } },
    (event) => events.push(event),
    { cores: 4 },
  )
  const last = events.at(-1)
  if (last?.type !== 'scanned') throw new Error(JSON.stringify(last))
  const { scan } = last
  return {
    events,
    scan,
    result: {
      ...scan.samples,
      folders: scan.folders,
      reports: scan.reports,
      ableton: scan.ableton,
    },
  }
}

describe('a scan in the page', () => {
  test('locates the project folder from the sets, checks them, and reports', async () => {
    const { events, result } = await check(
      [folder('p', pickedFolder(projects))],
      [folder('s', uploadedFolder(samples))],
    )
    expect(events.map((e) => e.type).filter((t) => t !== 'progress')).toEqual([
      'phase',
      'located',
      'phase',
      'indexed',
      'phase',
      'phase',
      'scanned',
    ])
    // The fixture sets say where their project was saved; the sample folder has no such witness.
    expect(result.folders).toEqual([
      { id: 'p', path: '/Users/someone/livesaver/fixtures/projects', how: 'found' },
      { id: 's', path: '/samples', how: 'unknown' },
    ])
    expect([result.projects, result.completeProjects, result.sets, result.completeSets]).toEqual([
      3, 3, 3, 3,
    ])
    expect(result.counts).toMatchObject({ ok: 1, found: 1, 'not-found': 0, mismatch: 0 })
    expect([result.changingSets, result.copyFiles, result.copyBytes]).toEqual([1, 1, 2000324])
    expect(result.changes).toEqual([
      {
        project: 'Brokenpath Project',
        set: 'Brokenpath.als',
        setPath: 'Brokenpath Project/Brokenpath.als',
        action: 'repaired',
        name: '1.wav',
        oldPath: '/Users/someone/livesaver/fixtures/samples/brokenpath/Lib1/Kick/1.wav',
        newPath: 'Samples/Imported/1.wav',
        source: '/samples/Lib1/Kick/1.wav',
        method: 'fingerprint ok, path end 3 level(s)',
        certain: true,
      },
    ])
    expect(result.foundSources).toEqual([
      {
        kind: 'Folder',
        name: 'samples/Lib1',
        samples: 1,
        projects: 1,
        hint: '',
        advice: '',
        inLibrary: 0,
      },
    ])
    expect(result.setRows.map((s) => [s.path, s.live, s.changes])).toEqual([
      ['Brokenpath Project/Brokenpath.als', '12.4.6', 1],
      ['Fixed Path Project/Fixed Path.als', '12.4.6', 0],
      ['VST2toVST3 Project/VST2toVST3.als', '12.4.6', 0],
    ])
    expect(Object.keys(result.reports).sort()).toEqual([
      'changes.csv',
      'missing_samples.csv',
      'missing_sources.csv',
      'overview.md',
      'projects.csv',
    ])
  })

  test('without a folder that has the sample it is missing, with its source and what to do', async () => {
    const broken = join(projects, 'Brokenpath Project')
    const { result } = await check([folder('p', uploadedFolder(broken))], [])
    // No reference of this set is stored relative to its project, so nothing says where it lies.
    expect(result.folders).toEqual([{ id: 'p', path: '/Brokenpath Project', how: 'unknown' }])
    expect(result.counts['not-found']).toBe(1)
    expect(result.missing.map((m) => [m.status, m.name, m.sets, m.projects])).toEqual([
      ['not-found', '1.wav', 1, 1],
    ])
    // A missing sample names the sets that use it and the source it is counted under.
    expect(result.missing[0]).toMatchObject({
      usedBy: ['Brokenpath.als'],
      sourceKind: result.missingSources[0]?.kind,
      sourceName: result.missingSources[0]?.name,
    })
    expect(result.missingSources[0]?.advice).toBe('folder')
    expect(result.missingSources).toHaveLength(1)
    expect(result.missingSources[0]?.hint).toContain('Find the folder or drive')
    expect([result.sets, result.completeSets, result.completeProjects]).toEqual([1, 0, 0])
  })

  test('a typed path is taken as it is, and a path stored in a set never invents a folder', async () => {
    // Typed where the set expects its sample: the file is there, so it only needs collecting.
    const typed = '/Users/someone/livesaver/fixtures/samples/brokenpath/'
    const { result } = await check(
      [folder('p', pickedFolder(projects))],
      [folder('s', pickedFolder(samples), { path: typed })],
    )
    expect(result.folders[1]).toEqual({ id: 's', path: typed.slice(0, -1), how: 'typed' })
    expect(result.counts).toMatchObject({ external: 1, found: 0 })
  })

  test('a sample folder that holds the project folder, or lies in it, is placed by it', async () => {
    const holding = await check(
      [folder('p', pickedFolder(projects))],
      [folder('all', pickedFolder(tmp.path))],
    )
    expect(holding.result.folders[1]).toEqual({
      id: 'all',
      path: '/Users/someone/livesaver/fixtures',
      how: 'found',
    })
    const inside = join(projects, 'Loops')
    cpSync(samples, inside, { recursive: true })
    const within = await check(
      [folder('p', pickedFolder(projects))],
      [folder('in', uploadedFolder(inside))],
    )
    expect(within.result.folders[1]).toEqual({
      id: 'in',
      path: '/Users/someone/livesaver/fixtures/projects/Loops',
      how: 'found',
    })
  })

  test("Ableton's own folders are recognised by name", async () => {
    writeFile(join(tmp.path, 'Ableton', 'User Library', 'Samples', 'a.wav'), 'RIFF')
    writeFile(join(tmp.path, 'Ableton', 'Factory Packs', 'Pack', 'Samples', 'b.wav'), 'RIFF')
    writeFile(join(tmp.path, 'Core Library', 'Samples', 'c.wav'), 'RIFF')
    const { result } = await check(
      [folder('p', pickedFolder(projects))],
      [
        folder('a', pickedFolder(join(tmp.path, 'Ableton'))),
        folder('c', uploadedFolder(join(tmp.path, 'Core Library'))),
      ],
    )
    expect(result.ableton).toEqual({
      userLibrary: '/Ableton/User Library',
      factoryPacks: '/Ableton/Factory Packs',
      coreLibrary: '/Core Library',
      remapEntries: 0,
    })
  })

  test("with Live's App-Resources folder, content Live moved between versions is found", async () => {
    // A set made with an older Live points at a Core Library sample that has another name now.
    const app = join(tmp.path, 'App-Resources')
    writeFile(join(app, 'Core Library', 'Samples', 'New Name.wav'), 'RIFF moved')
    mkdirSync(join(app, 'Database'), { recursive: true })
    const db = new Database(join(app, 'Database', 'filerefmap.db'))
    db.run(`CREATE TABLE sample_mapping (src_type int, src_packid varchar, src_ref varchar,
      dst_type int, dst_packid varchar, dst_ref varchar)`)
    db.run('CREATE TABLE pack_names (packid varchar, packname varchar)')
    db.run(
      `INSERT INTO sample_mapping VALUES (${REL_PACK}, '${CORE_LIBRARY_PACK_ID}', 'Samples/Old Name.wav',
        ${REL_PACK}, '${CORE_LIBRARY_PACK_ID}', 'Samples/New Name.wav')`,
    )
    db.close()
    const project = makeProject(tmp.path, 'Song')
    const old = deviceSet('/Applications/Live 10.app/Core Library/Samples/Old Name.wav', 10, 0, {
      relType: REL_PACK,
      relPath: 'Samples/Old Name.wav',
      packName: 'Core Library',
      packId: CORE_LIBRARY_PACK_ID,
    })
    writeSet(join(project, 'Song.als'), old.replaceAll('MxPatchRef', 'SampleRef'))

    const without = await check([folder('p', pickedFolder(project))], [])
    expect(without.result.counts['not-found']).toBe(1)
    const withApp = await check(
      [folder('p', pickedFolder(project))],
      [folder('a', pickedFolder(app))],
    )
    expect(withApp.result.ableton).toMatchObject({
      coreLibrary: '/App-Resources/Core Library',
      remapEntries: 1,
    })
    expect(withApp.result.counts).toMatchObject({ 'not-found': 0, external: 1 })
  })

  test('the Live app itself can be given: only its Core Library is searched', async () => {
    // An app is a folder to a drop: App-Resources lies in its Contents folder.
    const app = join(tmp.path, 'Ableton Live 12 Suite.app')
    const resources = join(app, 'Contents', 'App-Resources')
    cpSync(join(samples, 'Lib1'), join(resources, 'Core Library', 'Samples'), { recursive: true })
    // The same sample elsewhere in the app (a lesson, a Max package) is none to relink to.
    cpSync(join(samples, 'Lib1'), join(resources, 'Max', 'Samples'), { recursive: true })
    const broken = join(projects, 'Brokenpath Project')
    const { result } = await check(
      [folder('p', uploadedFolder(broken))],
      [folder('live', uploadedFolder(app))],
    )
    expect(result.ableton.coreLibrary).toBe(
      '/Ableton Live 12 Suite.app/Contents/App-Resources/Core Library',
    )
    expect(result.indexedFiles).toBe(1)
    expect(result.changes.map((c) => c.source)).toEqual([
      '/Ableton Live 12 Suite.app/Contents/App-Resources/Core Library/Samples/Kick/1.wav',
    ])
  })

  test('a folder of the user\'s with a "Core Library" in it is still searched as a whole', async () => {
    const mine = join(tmp.path, 'Mine')
    cpSync(join(samples, 'Lib1'), join(mine, 'Loops'), { recursive: true })
    writeFile(join(mine, 'Core Library', 'Samples', 'c.wav'), 'RIFF')
    const broken = join(projects, 'Brokenpath Project')
    const { result } = await check(
      [folder('p', uploadedFolder(broken))],
      [folder('m', uploadedFolder(mine))],
    )
    expect(result.ableton.coreLibrary).toBe('/Mine/Core Library')
    expect(result.changes.map((c) => c.source)).toEqual(['/Mine/Loops/Kick/1.wav'])
  })

  describe("Ableton's own folders are placed where the sets say they lie", () => {
    const APP = '/Applications/Ableton Live 12 Suite.app'
    /** A set that names one file of the Core Library, as the Live of `creator` stores it. */
    const coreSet = (app: string, creator = 'Ableton Live 12.3.2') =>
      deviceSet(`${app}/Contents/App-Resources/Core Library/Samples/c.wav`, 10, 0, {
        relType: REL_PACK,
        relPath: 'Samples/c.wav',
        packName: 'Core Library',
        packId: CORE_LIBRARY_PACK_ID,
      })
        .replaceAll('MxPatchRef', 'SampleRef')
        .replace('Ableton Live 12.3.2', creator)
    /** The Live app on a disk, with one sample in its Core Library. */
    const liveApp = () => {
      const app = join(tmp.path, 'Ableton Live 12 Suite.app')
      writeFile(join(app, 'Contents', 'App-Resources', 'Core Library', 'Samples', 'c.wav'), 'RIFF')
      return app
    }

    test('whichever folder of the Live app is given', async () => {
      const project = makeProject(tmp.path, 'Song')
      writeSet(join(project, 'Song.als'), coreSet(APP))
      const app = liveApp()
      const given = [
        ['', APP],
        ['Contents', `${APP}/Contents`],
        ['Contents/App-Resources', `${APP}/Contents/App-Resources`],
        ['Contents/App-Resources/Core Library', `${APP}/Contents/App-Resources/Core Library`],
      ] as const
      for (const [inside, at] of given) {
        const { result } = await check(
          [folder('p', pickedFolder(project))],
          [folder('live', uploadedFolder(join(app, inside)))],
        )
        expect([inside, result.folders[1]]).toEqual([
          inside,
          { id: 'live', path: at, how: 'found' },
        ])
        expect(result.ableton.coreLibrary).toBe(`${APP}/Contents/App-Resources/Core Library`)
        // The set's own path leads there now: the sample is where the set says.
        expect(result.counts['not-found']).toBe(0)
      }
    })

    test('the User Library and the Factory Packs, in the folder that holds them', async () => {
      const home = '/Users/someone/Music/Ableton'
      const project = makeProject(tmp.path, 'Song')
      writeSet(
        join(project, 'Song.als'),
        deviceSet(`${home}/Factory Packs/Pack/Samples/b.wav`, 4, 0, {
          relType: REL_PACK,
          relPath: 'Samples/b.wav',
          packName: 'Pack',
          packId: 'www.ableton.com/1',
        }).replaceAll('MxPatchRef', 'SampleRef'),
      )
      writeFile(join(tmp.path, 'Ableton', 'User Library', 'Samples', 'a.wav'), 'RIFF')
      writeFile(join(tmp.path, 'Ableton', 'Factory Packs', 'Pack', 'Samples', 'b.wav'), 'RIFF')
      const { result } = await check(
        [folder('p', pickedFolder(project))],
        [folder('a', uploadedFolder(join(tmp.path, 'Ableton')))],
      )
      expect(result.folders[1]).toEqual({ id: 'a', path: home, how: 'found' })
      expect(result.ableton).toMatchObject({
        userLibrary: `${home}/User Library`,
        factoryPacks: `${home}/Factory Packs`,
      })
    })

    test('a set of an older Live names the app of its time: the newest sets decide', async () => {
      const project = makeProject(tmp.path, 'Song')
      const old = '/Applications/Ableton Live 10 Suite.app'
      writeSet(join(project, 'A old.als'), coreSet(old, 'Ableton Live 10.1.30'))
      writeSet(join(project, 'B old.als'), coreSet(old, 'Ableton Live 10.1.30'))
      writeSet(join(project, 'C new.als'), coreSet(APP))
      const { result } = await check(
        [folder('p', pickedFolder(project))],
        [folder('live', uploadedFolder(join(liveApp(), 'Contents')))],
      )
      expect(result.folders[1]).toEqual({ id: 'live', path: `${APP}/Contents`, how: 'found' })
    })

    test('a path that was typed may be any path into the app', async () => {
      const project = makeProject(tmp.path, 'Song')
      writeSet(join(project, 'Song.als'), coreSet('/Applications/Ableton Live 10 Suite.app'))
      const contents = join(liveApp(), 'Contents')
      for (const typed of [
        APP,
        `${APP}/`,
        `${APP}/Contents`,
        `${APP}/Contents/App-Resources`,
        `${APP}/Contents/App-Resources/Core Library`,
      ]) {
        const { result } = await check(
          [folder('p', pickedFolder(project))],
          [folder('live', uploadedFolder(contents), { path: typed })],
        )
        expect([typed, result.folders[1]]).toEqual([
          typed,
          { id: 'live', path: `${APP}/Contents`, how: 'typed' },
        ])
      }
    })

    test('where no set says so, the place stays unknown: nothing is made up', async () => {
      const project = makeProject(tmp.path, 'Song')
      // The set names a file that is not in the folder that was given.
      writeSet(
        join(project, 'Song.als'),
        coreSet(APP).replaceAll('Samples/c.wav', 'Samples/other.wav'),
      )
      const contents = join(liveApp(), 'Contents')
      // A folder of the user's with a "Core Library" in it is not the app's, whatever sets say.
      const mine = join(tmp.path, 'Mine')
      writeFile(join(mine, 'Core Library', 'Samples', 'other.wav'), 'RIFF')
      const { result } = await check(
        [folder('p', pickedFolder(project))],
        [folder('live', uploadedFolder(contents)), folder('m', uploadedFolder(mine))],
      )
      expect(result.folders.slice(1)).toEqual([
        { id: 'live', path: '/Contents', how: 'unknown' },
        { id: 'm', path: '/Mine', how: 'unknown' },
      ])
    })
  })

  test('a failure is reported, not thrown', async () => {
    const broken = { kind: 'files', name: 'x', files: null } as unknown as FolderInput['source']
    const events: ScanEvent[] = []
    await scanFolders(
      {
        projects: [folder('p', broken)],
        search: [],
        options: { packLimitMB: 50, matchLibraryPath: false },
      },
      (event) => events.push(event),
      { cores: 4 },
    )
    expect(events.at(-1)?.type).toBe('failed')
  })

  test('the plug-ins the sets use are read along; whether they are installed is not known', async () => {
    const { scan } = await check([folder('p', pickedFolder(projects))], [])
    expect([scan.plugins.sets, scan.plugins.projects, scan.plugins.inventory]).toEqual([
      3,
      3,
      false,
    ])
    expect(scan.plugins.uses.map((u) => [u.name, u.format, u.state, u.instances, u.sets])).toEqual([
      ['Massive', 'VST2', 'unknown', 1, ['VST2toVST3 Project/VST2toVST3.als']],
      ['Massive', 'VST3', 'unknown', 1, ['VST2toVST3 Project/VST2toVST3.als']],
      ['Omnisphere', 'VST2', 'unknown', 1, ['VST2toVST3 Project/VST2toVST3.als']],
      ['Omnisphere', 'VST3', 'unknown', 1, ['VST2toVST3 Project/VST2toVST3.als']],
      ['Serum', 'VST2', 'unknown', 1, ['VST2toVST3 Project/VST2toVST3.als']],
      ['Serum', 'VST3', 'unknown', 1, ['VST2toVST3 Project/VST2toVST3.als']],
    ])
    expect(scan.plugins.installed).toEqual([])
    expect(scan.plugins.counts).toMatchObject({ used: 6, missing: 0, rosetta: 0 })
    expect(Object.keys(scan.seconds).sort()).toEqual([
      'checking',
      'indexing',
      'locating',
      'reporting',
    ])
  })
})
