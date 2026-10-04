/**
 * collect with --apply in temp dirs: relinking, collecting, packs, old formats. (Max devices:
 * `collect-devices.test.ts`.)
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { liveCrc, REL_DOCUMENT, REL_PACK, REL_PROJECT } from '@livesaver/core'
import { createNodeHost } from '@livesaver/node'
import {
  copyFixtures,
  deviceSet,
  fileRefBodies,
  fixturesDir,
  LIVE9_SET,
  makeProject,
  OLD_SET,
  readSet,
  snapshot,
  stripSampleRefs,
  WINDOWS_PATH,
  writeFile,
  writeSet,
} from '@livesaver/test-kit'
import { summary } from '../src/index.js'
import { csv, mtimeUs, refsOf, useCollect } from './collect-kit.js'

const fixtures = fixturesDir()

const { tmp, run } = useCollect()

describe('Brokenpath', () => {
  let projects: string
  let samples: string
  let project: string
  let setPath: string
  let original: string
  beforeEach(() => {
    ;({ projects, samples } = copyFixtures(tmp.path))
    project = join(projects, 'Brokenpath Project')
    setPath = join(project, 'Brokenpath.als')
    original = readSet(setPath)
  })

  test('dry run changes nothing', async () => {
    const before = snapshot(projects)
    const r = await run([project], [samples])
    expect(snapshot(projects)).toEqual(before)
    const [change, ...rest] = csv(r.reports['changes.csv'] as string)
    expect(rest).toHaveLength(0)
    expect(change?.Action).toBe('repaired')
    expect(change?.['Copied from']).toBe(join(samples, 'Lib1', 'Kick', '1.wav'))
    expect(change?.['New path (in project)']).toBe(join('Samples', 'Imported', '1.wav'))
    expect(change?.Confidence).toBe('certain')
    const lines = summary(r.results, r.projects, false).split('\n')
    const found = lines.indexOf('Most common sources of found samples:')
    expect(lines[found + 1]?.trim()).toBe('1 samples in    1 projects  Folder: samples/Lib1')
  })

  test('apply equals Live\'s "Collect All and Save"', async () => {
    const mtime = mtimeUs(setPath)
    const backupDir = join(project, 'Backup')
    const oldBackups = new Set(existsSync(backupDir) ? readdirSync(backupDir) : [])
    const r = await run([project], [samples], { apply: true })
    expect(r.results[0]?.error).toBe('')
    const now = readSet(setPath)

    const fixedPath = join(fixtures, 'projects', 'Fixed Path Project')
    const fixed = readSet(join(fixedPath, 'Fixed Path.als'))
    // Live stored absolute paths of the folder the project was saved in; compare relative to it.
    const [saved] = await refsOf(join(fixedPath, 'Fixed Path.als'))
    const savedAt = saved?.path.slice(0, -(saved.relPath.length + 1)) as string
    const expected = fileRefBodies(fixed).map((b) => b.replaceAll(savedAt, project))
    expect(fileRefBodies(now)).toEqual(expected)

    const copied = join(project, 'Samples', 'Imported', '1.wav')
    expect(existsSync(`${copied}.asd`)).toBe(true) // only Lib1 has an .asd -> copied from Lib1
    const refs = await refsOf(setPath)
    expect(new Set(refs.map((x) => x.lastMod))).toEqual(
      new Set([String(Math.floor(statSync(copied).mtimeMs / 1000))]),
    )
    expect(stripSampleRefs(now)).toBe(stripSampleRefs(original))
    // The set was saved by the fix, and says so; its backup keeps the date it had.
    expect(mtimeUs(setPath)).toBeGreaterThan(mtime)

    const created = readdirSync(backupDir).filter((f) => !oldBackups.has(f))
    expect(created).toHaveLength(1)
    expect(created[0]).toMatch(/^Brokenpath \[\d{4}-\d\d-\d\d \d{6}\]\.als$/)
    expect(readSet(join(backupDir, created[0] as string))).toBe(original)
    expect(Math.abs(mtimeUs(join(backupDir, created[0] as string)) - mtime)).toBeLessThanOrEqual(1)
    const [row] = csv(r.reports['projects.csv'] as string)
    expect([row?.Status, row?.repaired, row?.Changes]).toEqual(['complete', '1', '1'])
  })

  test('a second run changes nothing', async () => {
    await run([project], [samples], { apply: true })
    const before = snapshot(projects)
    const r = await run([project], [samples], { apply: true })
    expect(snapshot(projects)).toEqual(before)
    expect(r.results[0]?.changes).toEqual([])
    expect(csv(r.reports['changes.csv'] as string)).toEqual([])
  })

  test('an unfindable sample goes to the CSV', async () => {
    const r = await run([project], [], { apply: true })
    expect(r.results[0]?.written).toBe(false)
    expect(readSet(setPath)).toBe(original)
    const [row] = csv(r.reports['missing_samples.csv'] as string)
    expect([row?.Status, row?.['File name'], row?.Sets]).toEqual(['not found', '1.wav', '1'])
    expect(row?.['Original path']?.endsWith('samples/brokenpath/Lib1/Kick/1.wav')).toBe(true)
    const [project1] = csv(r.reports['projects.csv'] as string)
    expect(project1?.Status).toBe('incomplete')
    expect(r.reports['overview.md']).toContain('| Sets | 1 |')
    expect(r.reports['overview.md']).toContain('| Distinct missing samples | 1 |')
  })
})

describe('collect external', () => {
  test('an existing external sample is collected', async () => {
    const { projects } = copyFixtures(tmp.path)
    const project = makeProject(projects, 'Ext')
    const backupDir = join(projects, 'Fixed Path Project', 'Backup')
    const backup = join(backupDir, readdirSync(backupDir).find((f) => f.endsWith('.als')) as string)
    const setPath = writeFile(join(project, 'Ext.als'), readFileSync(backup)) // → ../../samples/Lib1/Kick/1.wav
    const r = await run([project], [], { apply: true })
    expect(r.results[0]?.changes.map((c) => c.action)).toEqual(['collected'])
    for (const ref of await refsOf(setPath)) {
      expect([ref.relType, ref.relPath]).toEqual([REL_PROJECT, 'Samples/Imported/1.wav'])
      expect(ref.path).toBe(join(project, 'Samples', 'Imported', '1.wav'))
    }
    expect(existsSync(join(project, 'Samples', 'Imported', '1.wav.asd'))).toBe(true)
  })
})

describe('big pack files', () => {
  let projects: string
  let packs: string
  let packFile: string
  beforeEach(() => {
    ;({ projects } = copyFixtures(tmp.path))
    packs = join(tmp.path, 'packs')
    packFile = writeFile(
      join(packs, 'Big Pack', 'Samples', 'Lib1', 'Kick', '1.wav'),
      readFileSync(join(fixtures, 'samples', 'Lib1', 'Kick', '1.wav')),
    )
    writeFile(
      join(packs, 'Big Pack', 'Ableton Folder Info', 'Properties.cfg'),
      'FolderConfigData\n{\n  String PackUniqueID = "www.ableton.com/999";\n  String PackDisplayName = "Big Pack";\n}\n',
    )
  })
  const fix = (project: string) =>
    run([project], [packs], { env: { factoryPacks: packs }, apply: true, packLimit: 1_000_000 })

  test('new format points into the pack', async () => {
    const project = join(projects, 'Brokenpath Project')
    const r = await fix(project)
    expect(r.results[0]?.error).toBe('')
    expect(r.results[0]?.changes[0]?.method).toContain('kept in the pack')
    for (const ref of await refsOf(join(project, 'Brokenpath.als'))) {
      expect([ref.relType, ref.relPath, ref.path]).toEqual([
        REL_PACK,
        'Samples/Lib1/Kick/1.wav',
        packFile,
      ])
      expect([ref.packName, ref.packId]).toEqual(['Big Pack', 'www.ableton.com/999'])
    }
    expect(existsSync(join(project, 'Samples'))).toBe(false)
    expect((await fix(project)).results[0]?.changes).toEqual([])
  })

  test('old format points into the pack', async () => {
    const project = makeProject(tmp.path, 'Old')
    const setPath = join(project, 'Old.als')
    writeSet(setPath, OLD_SET)
    expect((await fix(project)).results[0]?.error).toBe('')
    const [ref] = await refsOf(setPath)
    expect([ref?.relType, ref?.relDirs]).toEqual([REL_PACK, ['Samples', 'Lib1', 'Kick']])
    expect([ref?.packName, ref?.packId, ref?.hintPath]).toEqual([
      'Big Pack',
      'www.ableton.com/999',
      packFile,
    ])
    expect((await fix(project)).results[0]?.changes).toEqual([])
  })

  test('a pack without an id is referenced relative to the set', async () => {
    rmSync(join(packs, 'Big Pack', 'Ableton Folder Info', 'Properties.cfg'))
    const project = join(projects, 'Brokenpath Project')
    expect((await fix(project)).results[0]?.error).toBe('')
    const [ref] = await refsOf(join(project, 'Brokenpath.als'))
    expect([ref?.relType, ref?.relPath]).toEqual([
      REL_DOCUMENT,
      '../../packs/Big Pack/Samples/Lib1/Kick/1.wav',
    ])
  })
})

describe('library file with other tags', () => {
  test('relinked only with matchLibraryPath, and reported as uncertain', async () => {
    const shaker = join('Drum Library', 'Samples', 'Drums', 'Shaker', 'Shaker 1.wav')
    const library = join(tmp.path, 'NI')
    // The set was made with an older version of the library: same sound, other tags, one byte less.
    const old = new TextEncoder().encode(`RIFF${'shaker '.repeat(400)}tags 1.0`)
    const installed = new TextEncoder().encode(`RIFF${'shaker '.repeat(400)}tags 1.1!`)
    const source = writeFile(join(library, shaker), installed)
    const project = makeProject(tmp.path, 'Song')
    const setPath = join(project, 'Song.als')
    const text = deviceSet(`/Volumes/Old Disk/Maschine Library/${shaker}`, old.length, liveCrc(old))
    writeSet(setPath, text.replaceAll('MxPatchRef', 'SampleRef'))
    const vendor = { env: { vendorLibraries: [library] } }

    const strict = await run([project], [library], vendor)
    expect(strict.results[0]?.counts.mismatch).toBe(1)
    expect(strict.results[0]?.changes).toEqual([])

    const r = await run([project], [library], { ...vendor, matchLibraryPath: true, apply: true })
    expect(r.results[0]?.error).toBe('')
    const imported = join('Samples', 'Imported', 'Shaker 1.wav')
    expect(r.results[0]?.changes.map((c) => [c.action, c.newPath, c.check, c.certain])).toEqual([
      ['repaired', imported, 'library-path', false],
    ])
    expect(readFileSync(join(project, imported))).toEqual(readFileSync(source))
    const [change] = csv(r.reports['changes.csv'] as string)
    expect([change?.Method, change?.Confidence]).toEqual([
      'name and library path only (other fingerprint), path end 5 level(s)',
      'uncertain',
    ])
    const [ref] = await refsOf(setPath)
    expect([ref?.relType, ref?.relPath]).toEqual([REL_PROJECT, imported])
    // complete now, also for a run without the option
    expect((await run([project], [library], vendor)).results[0]?.counts.ok).toBe(1)
  })
})

describe('old formats', () => {
  test('a Live 10 set is relinked and collected', async () => {
    const { samples } = copyFixtures(tmp.path)
    const project = makeProject(tmp.path, 'Old')
    const setPath = join(project, 'Old.als')
    writeSet(setPath, OLD_SET)
    const r = await run([project], [samples], { apply: true })
    expect(r.results[0]?.error).toBe('')
    const now = readSet(setPath)
    const [ref] = await refsOf(setPath)
    const imported = join(project, 'Samples', 'Imported')
    expect([ref?.relType, ref?.relDirs, ref?.name]).toEqual([
      REL_PROJECT,
      ['Samples', 'Imported'],
      '1.wav',
    ])
    expect(ref?.hintPath).toBe(join(imported, '1.wav'))
    expect(ref?.path).toBe(WINDOWS_PATH)
    expect([ref?.size, ref?.crc]).toEqual([2000324, 17226])
    expect(now).toContain('<RelativePathElement Id="239" Dir="Samples" />')
    expect(stripSampleRefs(now)).toBe(stripSampleRefs(OLD_SET))
    expect(existsSync(join(imported, '1.wav.asd'))).toBe(true)
    expect((await run([project], [samples], { apply: true })).results[0]?.changes).toEqual([])
  })

  test('a Live 9 name collision gets a new name', async () => {
    const project = makeProject(tmp.path, 'Nine')
    writeSet(join(project, 'Nine.als'), LIVE9_SET)
    const library = join(tmp.path, 'library')
    writeFile(join(library, 'Rock & Roll.wav'), 'library version')
    writeFile(
      join(project, 'Samples', 'Imported', 'Rock & Roll.wav'),
      'a different file with the same name',
    )
    const r = await run([project], [library], { apply: true })
    expect(r.results[0]?.error).toBe('')
    const [ref] = await refsOf(join(project, 'Nine.als'))
    expect(ref?.relPath).toBe('Samples/Imported/Rock & Roll-2.wav')
    expect(readFileSync(join(project, 'Samples', 'Imported', 'Rock & Roll-2.wav'), 'utf8')).toBe(
      'library version',
    )
  })
})

describe('copy metadata', () => {
  test('the copy keeps content and modification time', async () => {
    const source = writeFile(join(tmp.path, 'Basso.aiff'), 'FORM system sound')
    utimesSync(source, 1_500_000_000, 1_500_000_000)
    const dst = join(tmp.path, 'copy', 'copy.aiff')
    await createNodeHost({ write: true }).write?.copyFile(source, dst)
    expect(readFileSync(dst, 'utf8')).toBe('FORM system sound')
    expect(Math.floor(statSync(dst).mtimeMs / 1000)).toBe(1_500_000_000)
  })
})
