/** collect with --apply in temp dirs: relinking, collecting, Max devices, packs, old formats. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import {
  EMPTY_REMAP,
  fileRefs,
  liveCrc,
  REL_DOCUMENT,
  REL_PACK,
  REL_PROJECT,
  remapKey,
} from '@livesaver/core'
import { createNodeHost } from '@livesaver/node'
import {
  amxd,
  copyFixtures,
  deviceSet,
  docFromText,
  fileRefBodies,
  fixturesDir,
  LIVE9_SET,
  makeProject,
  OLD_SET,
  oldDeviceSet,
  readSet,
  snapshot,
  stripSampleRefs,
  tempDir,
  WINDOWS_PATH,
  writeFile,
  writeSet,
} from '@livesaver/test-kit'
import {
  applyWriter,
  buildReports,
  DEFAULT_PACK_LIMIT,
  type DoctorResult,
  doctor,
  type EnvConfig,
  Probe,
  summary,
} from '../src/index.js'

const fixtures = fixturesDir()

let tmp: { path: string; cleanup: () => void }
let runs = 0
beforeEach(() => {
  tmp = tempDir()
})
afterEach(() => tmp.cleanup())

function env(config: Partial<EnvConfig> = {}): EnvConfig {
  return {
    userLibrary: '',
    factoryPacks: '',
    appResources: '',
    preferredRoots: [],
    vendorLibraries: [],
    remap: EMPTY_REMAP,
    ...config,
  }
}

interface Run extends DoctorResult {
  readonly reports: Record<string, string>
}

async function run(
  targets: string[],
  search: string[],
  options: {
    env?: Partial<EnvConfig>
    apply?: boolean
    packLimit?: number
    matchLibraryPath?: boolean
  } = {},
): Promise<Run> {
  const host = createNodeHost({ write: true })
  const probe = new Probe(host.fs, host.hash)
  const context = { id: `test-${++runs}`, dir: join(tmp.path, `run-${runs}`) }
  const result = await doctor(host, {
    targets,
    searchRoots: search,
    env: env(options.env),
    packCopyLimit: options.packLimit ?? DEFAULT_PACK_LIMIT,
    matchLibraryPath: options.matchLibraryPath ?? false,
    probe,
    ...(options.apply ? { writer: applyWriter(host, context, probe) } : {}),
  })
  return { ...result, reports: await buildReports(result.results, result.base, probe) }
}

/** Rows of a generated CSV as objects (BOM, CRLF, minimal quoting). */
function csv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const s = text.replace(/^\ufeff/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\r' && s[i + 1] === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
    } else field += c
  }
  const [head = [], ...body] = rows
  return body.map((r) => Object.fromEntries(head.map((h, k) => [h, r[k] ?? ''])))
}

const mtimeUs = (p: string) => Math.round(Number(statSync(p, { bigint: true }).mtimeNs) / 1000)
const refsOf = async (path: string) => fileRefs(await docFromText(readSet(path)))

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

describe('Max devices', () => {
  const LFO = join('Presets', 'Audio Effects', 'Max Audio Effect', 'Imported', 'LFO.amxd')

  test('a missing device from a USB stick is relinked and collected', async () => {
    const library = join(tmp.path, 'library')
    const data = amxd()
    const source = writeFile(join(library, 'Stick Project', LFO), data)
    const project = makeProject(tmp.path, 'Track')
    const setPath = join(project, 'Track 2.als')
    const stick = `/Volumes/NO NAME/Stick Project/${LFO}`
    writeSet(
      setPath,
      deviceSet(stick, data.length, liveCrc(data), { relPath: `../../../../..${stick}` }),
    )
    const mtime = mtimeUs(setPath)

    const r = await run([project], [library], { apply: true })
    const result = r.results[0]
    expect(result?.error).toBe('')
    expect(result?.changes.map((c) => [c.action, c.newPath, c.certain])).toEqual([
      ['repaired', LFO, true],
    ])
    const [ref] = await refsOf(setPath)
    const copied = join(project, LFO)
    expect([ref?.kind, ref?.relType, ref?.relPath, ref?.path]).toEqual([
      'device',
      REL_PROJECT,
      LFO,
      copied,
    ])
    expect(ref?.lastMod).toBe(String(Math.floor(statSync(copied).mtimeMs / 1000)))
    expect(readFileSync(copied)).toEqual(readFileSync(source))
    expect(mtimeUs(setPath)).toBeGreaterThanOrEqual(mtime)
    expect(existsSync(join(project, 'Samples'))).toBe(false)
    expect((await run([project], [library], { apply: true })).results[0]?.changes).toEqual([])
  })

  test('device types go to their preset folders', async () => {
    const cases: [string, string, string][] = [
      ['iiii', 'DS Tom.amxd', join('Presets', 'Instruments', 'Max Instrument', 'Imported')],
      ['mmmm', 'Arp.amxd', join('Presets', 'MIDI Effects', 'Max MIDI Effect', 'Imported')],
      ['natt', 'Tool.amxd', join('Presets', 'Imported')],
    ]
    for (const [code, name, folder] of cases) {
      const library = join(tmp.path, `lib-${code}`)
      const data = amxd(code)
      writeFile(join(library, name), data)
      const project = makeProject(tmp.path, `Types ${code}`)
      writeSet(
        join(project, 'S.als'),
        deviceSet(`/old/disk/${name}`, data.length, liveCrc(data), {
          relPath: `../../old/disk/${name}`,
        }),
      )
      const r = await run([project], [library], { apply: true })
      expect(r.results[0]?.error).toBe('')
      expect(existsSync(join(project, folder, name))).toBe(true)
    }
  })

  test('a Live 10 device from another project reuses the identical copy', async () => {
    const other = makeProject(tmp.path, 'Other')
    const data = amxd()
    writeFile(join(other, LFO), data)
    const project = makeProject(tmp.path, 'Own')
    writeFile(join(project, LFO), data)
    const setPath = join(project, 'Own.als')
    const text = oldDeviceSet(data.length, liveCrc(data))
    writeSet(setPath, text)

    const r = await run([project], [], { apply: true })
    expect([r.results[0]?.error, r.results[0]?.changes.map((c) => c.action)]).toEqual([
      '',
      ['collected'],
    ])
    expect(r.projects[0]?.copiedFiles).toBe(0)
    const now = readSet(setPath)
    const [ref] = await refsOf(setPath)
    expect([ref?.relType, ref?.relDirs, ref?.name]).toEqual([
      REL_PROJECT,
      ['Presets', 'Audio Effects', 'Max Audio Effect', 'Imported'],
      'LFO.amxd',
    ])
    expect(ref?.hintPath).toBe(join(project, LFO))
    expect(now).toContain('<RelativePathElement Id="44" Dir="Presets" />')
    expect(stripSampleRefs(now)).toBe(stripSampleRefs(text))
  })

  test('pack devices stay in the pack', async () => {
    const packs = join(tmp.path, 'packs')
    const data = amxd()
    const packFile = writeFile(
      join(packs, 'Creative Extensions', 'Devices', 'Color Limiter.amxd'),
      data,
    )
    writeFile(
      join(packs, 'Creative Extensions', 'Ableton Folder Info', 'Properties.cfg'),
      'FolderConfigData\n{\n  String PackUniqueID = "www.ableton.com/250";\n  String PackDisplayName = "Creative Extensions";\n}\n',
    )
    const project = makeProject(tmp.path, 'Pack')
    const inPack = join(project, 'In Pack.als')
    writeSet(
      inPack,
      deviceSet(packFile, data.length, liveCrc(data), {
        relType: REL_PACK,
        relPath: 'Devices/Color Limiter.amxd',
        packName: 'Creative Extensions',
        packId: 'www.ableton.com/250',
      }),
    )
    const moved = join(project, 'Moved.als')
    writeSet(
      moved,
      deviceSet(
        'E:\\Ableton\\Factory Packs\\Creative Extensions\\Devices\\Color Limiter.amxd',
        data.length,
        liveCrc(data),
      ),
    )
    const before = readSet(inPack)
    const r = await run([project], [packs], { env: { factoryPacks: packs }, apply: true })
    const byName = new Map(r.results.map((x) => [x.setPath.split('/').at(-1), x]))
    expect([byName.get('In Pack.als')?.changes, byName.get('In Pack.als')?.counts.kept]).toEqual([
      [],
      1,
    ])
    expect(readSet(inPack)).toBe(before)
    const [change] = byName.get('Moved.als')?.changes ?? []
    expect(change?.method).toContain('kept in the pack (Max device)')
    const [ref] = await refsOf(moved)
    expect([ref?.relType, ref?.relPath, ref?.packId]).toEqual([
      REL_PACK,
      'Devices/Color Limiter.amxd',
      'www.ableton.com/250',
    ])
    expect(existsSync(join(project, 'Presets'))).toBe(false)
  })

  test("a Live device is left to Live (Live's remap table)", async () => {
    const app = join(tmp.path, 'App-Resources')
    writeFile(
      join(app, 'Builtin', 'Devices', 'Audio Effects', 'LFO', 'Ableton Folder Info', 'LFO.amxd'),
      amxd('aaaa', 'new'),
    )
    const remap = {
      mapping: new Map<string, readonly [number, string, string]>([
        [
          remapKey(5, 'www.ableton.com/0', 'Devices/Audio Effects/Max Audio Effect/LFO.amxd'),
          [7, '', 'Devices/Audio Effects/LFO/Ableton Folder Info/LFO.amxd'],
        ],
      ]),
      packNames: new Map<string, string>(),
    }
    const library = join(tmp.path, 'library')
    const data = amxd('aaaa', 'old')
    writeFile(join(library, 'Old Project', LFO), data)
    const project = makeProject(tmp.path, 'Ten')
    const setPath = join(project, 'Ten.als')
    const old =
      '/Applications/Ableton Live 10 Suite.app/Contents/App-Resources/Core Library/Devices/Audio Effects/Max Audio Effect/LFO.amxd'
    writeSet(
      setPath,
      deviceSet(old, data.length, liveCrc(data), {
        relType: REL_PACK,
        relPath: 'Devices/Audio Effects/Max Audio Effect/LFO.amxd',
        packName: 'Core Library',
        packId: 'www.ableton.com/0',
      }),
    )
    const before = readSet(setPath)
    const r = await run([project], [library], { env: { appResources: app, remap }, apply: true })
    const result = r.results[0]
    expect([result?.changes, result?.counts.kept, result?.error]).toEqual([[], 1, ''])
    expect(readSet(setPath)).toBe(before)
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
