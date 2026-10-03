/** The engine behind the page: locating folders, checking sets, shaping the result. */

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cpSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { CORE_LIBRARY_PACK_ID, REL_PACK } from '@livesaver/core'
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
import { run } from '../src/engine.js'
import type { EngineEvent, FolderInput, RunResult } from '../src/protocol.js'

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

async function check(
  projectFolders: FolderInput[],
  search: FolderInput[],
  matchLibraryPath = false,
): Promise<{ events: EngineEvent[]; result: RunResult }> {
  const events: EngineEvent[] = []
  await run(
    { projects: projectFolders, search, options: { packLimitMB: 50, matchLibraryPath } },
    (event) => events.push(event),
    { cores: 4 },
  )
  const last = events.at(-1)
  if (last?.type !== 'done') throw new Error(JSON.stringify(last))
  return { events, result: last.result }
}

describe('a run in the page', () => {
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
      'done',
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
      { kind: 'Folder', name: 'samples/Lib1', samples: 1, projects: 1, hint: '' },
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
    expect(result.missingSources).toHaveLength(1)
    expect(result.missingSources[0]?.hint).toBe(
      'Find the folder or drive and add it as a sample folder',
    )
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

  test('a failure is reported, not thrown', async () => {
    const broken = { kind: 'files', name: 'x', files: null } as unknown as FolderInput['source']
    const events: EngineEvent[] = []
    await run(
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
})
