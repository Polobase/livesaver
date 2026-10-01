/** Installed plug-ins (Live's database, Audio Units, bundles): native or Rosetta, matched by id. */
import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { encodeBinaryPlist, type PlistValue, type PluginRef } from '@livesaver/core'
import { type Inventory, loadInventory, parseAuval } from '@livesaver/plugins'
import { tempDir, writeFile } from '@livesaver/test-kit'
import {
  loadInstalledPlugins,
  NodeFs,
  readLivePluginDatabase,
  registeredAudioUnits,
} from '../src/index.js'

const ARM64 = 0x0100000c
const X86_64 = 0x01000007

function thin(cpu: number): Uint8Array {
  const b = new Uint8Array(32)
  b.set([0xcf, 0xfa, 0xed, 0xfe])
  new DataView(b.buffer).setUint32(4, cpu, true)
  return b
}

function fat(...cpus: number[]): Uint8Array {
  const b = new Uint8Array(8 + cpus.length * 20)
  const v = new DataView(b.buffer)
  b.set([0xca, 0xfe, 0xba, 0xbe])
  v.setUint32(4, cpus.length)
  for (const [i, c] of cpus.entries()) v.setUint32(8 + i * 20, c)
  return b
}

/** An XML Info.plist like Xcode writes. */
function xmlPlist(value: PlistValue, indent = ''): string {
  if (typeof value === 'string') return `${indent}<string>${value}</string>`
  if (Array.isArray(value))
    return `${indent}<array>\n${value.map((v) => xmlPlist(v, `${indent}\t`)).join('\n')}\n${indent}</array>`
  const entries = Object.entries(value as Record<string, PlistValue>)
  return `${indent}<dict>\n${entries.map(([k, v]) => `${indent}\t<key>${k}</key>\n${xmlPlist(v, `${indent}\t`)}`).join('\n')}\n${indent}</dict>`
}

function bundle(
  path: string,
  binary: Uint8Array,
  info: Record<string, PlistValue> = {},
  xml = true,
): string {
  const name = path
    .split('/')
    .at(-1)
    ?.replace(/\.[^.]+$/, '') as string
  writeFile(join(path, 'Contents', 'MacOS', name), binary)
  const plist = { CFBundleExecutable: name, ...info }
  writeFile(
    join(path, 'Contents', 'Info.plist'),
    xml
      ? `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${xmlPlist(plist)}\n</plist>\n`
      : encodeBinaryPlist(plist),
  )
  return path
}

function component(
  path: string,
  binary: Uint8Array,
  type: string,
  subtype: string,
  manufacturer: string,
  name: string,
) {
  return bundle(path, binary, { AudioComponents: [{ type, subtype, manufacturer, name }] })
}

const ref = (format: PluginRef['format'], ident: string, name: string): PluginRef => ({
  format,
  ident,
  name,
})

let tmp: { path: string; cleanup: () => void }
beforeEach(() => {
  tmp = tempDir()
})
afterEach(() => tmp.cleanup())

describe('Mach-O bundles (MachOTest)', () => {
  test('native, Intel-only and unknown bundles', async () => {
    const { Bundles } = await import('@livesaver/plugins')
    const bundles = new Bundles(new NodeFs())
    expect(await bundles.native(bundle(join(tmp.path, 'A.vst'), fat(X86_64, ARM64)))).toBe(true)
    expect(await bundles.native(bundle(join(tmp.path, 'B.vst'), thin(X86_64), {}, false))).toBe(
      false,
    )
    expect(await bundles.native(join(tmp.path, 'missing.vst'))).toBeUndefined()
  })
})

describe('the catalog (CatalogTest)', () => {
  let dbDir: string
  let root: string
  let modules: [number, string, number, number, number][]
  let rows: [number, string, string, number][]
  beforeEach(() => {
    dbDir = join(tmp.path, 'Live Database')
    root = join(tmp.path, 'Plug-Ins')
    mkdirSync(dbDir, { recursive: true })
    modules = []
    rows = []
  })
  const module = (path: string, processor: number, scanstate = 1) => {
    modules.push([modules.length + 1, path, 2, processor, scanstate])
    return modules.length
  }
  const plugin = (moduleId: number, devIdentifier: string, name: string) => {
    rows.push([moduleId, devIdentifier, name, 1])
  }
  const catalog = async (): Promise<Inventory> => {
    const db = new Database(join(dbDir, 'Live-plugins-1.db'))
    db.run(
      'CREATE TABLE plugin_modules (module_id INTEGER PRIMARY KEY, path TEXT, arch INTEGER, processor INTEGER, scanstate INTEGER, fingerprint TEXT)',
    )
    db.run(
      'CREATE TABLE plugins (plugin_id INTEGER PRIMARY KEY AUTOINCREMENT, module_id INTEGER, dev_identifier TEXT, name TEXT, enabled INTEGER)',
    )
    for (const m of modules) db.run("INSERT INTO plugin_modules VALUES (?, ?, ?, ?, ?, '')", m)
    for (const r of rows)
      db.run(
        'INSERT INTO plugins (module_id, dev_identifier, name, enabled) VALUES (?, ?, ?, ?)',
        r,
      )
    db.close()
    return loadInstalledPlugins({
      database: dbDir,
      pluginRoots: [root],
      systemComponents: '',
      auval: false,
    })
  }

  test('the processor decides native or Rosetta', async () => {
    const serum = bundle(join(root, 'VST', 'Serum.vst'), fat(X86_64, ARM64))
    const massive = bundle(join(root, 'VST', 'Massive.vst'), thin(X86_64))
    for (const processor of [1, 2])
      plugin(module(serum, processor), 'device:vst:instr:1483109208?n=Serum', 'Serum')
    plugin(module(massive, 1), 'device:vst:instr:1315523937?n=Massive', 'Massive')
    module(massive, 2, 3) // Live on Apple Silicon could not load it
    const gone = module(join(root, 'VST', 'Deleted.vst'), 2)
    plugin(gone, 'device:vst:instr:42?n=Deleted', 'Deleted')
    plugin(
      module(join(root, 'VST3', 'Massive.vst3'), 2),
      'device:vst3:instr:5653544e-694d-616d-6173-736976650000',
      'Massive',
    )
    mkdirSync(join(root, 'VST3', 'Massive.vst3'), { recursive: true })
    const c = await catalog()
    expect(c.status(ref('VST2', '1483109208', 'Serum')).state).toBe('installed')
    expect(c.status(ref('VST2', '1315523937', 'Massive')).state).toBe('rosetta')
    expect(c.status(ref('VST2', '42', 'Deleted')).state).toBe('missing')
    expect(c.status(ref('VST3', '5653544e694d616d6173736976650000', 'Massive')).state).toBe(
      'installed',
    )
  })

  test('shared VST2 ids are told apart by name', async () => {
    const chords = bundle(join(root, 'VST', 'Captain Chords.vst'), thin(ARM64))
    const beat = bundle(join(root, 'VST', 'Captain Beat.vst'), thin(X86_64))
    plugin(module(chords, 2), 'device:vst:instr:1234?n=Captain%20Chords', 'Captain Chords')
    plugin(module(beat, 1), 'device:vst:instr:1234?n=Captain%20Beat', 'Captain Beat')
    const c = await catalog()
    expect(c.status(ref('VST2', '1234', 'Captain Beat')).state).toBe('rosetta')
    expect(c.status(ref('VST2', '1234', 'Captain Chords_x64')).state).toBe('installed')
    expect(c.status(ref('VST2', '1234', 'Other')).state).toBe('installed') // the id counts
  })

  test('Audio Units and bundles Live has not scanned', async () => {
    const components = join(root, 'Components')
    component(
      join(components, 'Serum.component'),
      fat(X86_64, ARM64),
      'aumu',
      'XfsX',
      'XFER',
      'Serum',
    )
    component(
      join(components, 'Mini V3.component'),
      thin(X86_64),
      'aumu',
      'MIN3',
      'Artu',
      'Mini V3',
    )
    bundle(join(root, 'VST', 'Mini V3.vst'), thin(X86_64))
    const vst3 = bundle(join(root, 'VST3', 'RoughRider3.vst3'), fat(X86_64, ARM64))
    writeFile(
      join(vst3, 'Contents', 'Resources', 'moduleinfo.json'),
      '{"Classes": [{"CID": "ABCDEF0191827A6B41754461525233F0", "Name": "RoughRider3",},]}',
    )
    const c = await catalog()
    expect(c.status(ref('AU', 'aumu:XfsX:XFER', 'Serum')).state).toBe('installed')
    const mini = c.status(
      ref(
        'VST2',
        String(new DataView(new TextEncoder().encode('MIN3').buffer).getUint32(0)),
        'Mini V3',
      ),
    )
    expect([mini.state, mini.found[0]?.scanned]).toEqual(['rosetta', false])
    expect(c.status(ref('VST3', 'abcdef0191827a6b41754461525233f0', 'RoughRider3')).state).toBe(
      'installed',
    )
  })

  test('a bundle that Live could not load is only a hint', async () => {
    const rider = bundle(join(root, 'VST', 'RoughRider.vst'), thin(X86_64))
    for (const processor of [1, 2]) module(rider, processor, 3)
    const c = await catalog()
    const r = ref('VST2', '1095004786', 'RoughRider_x64')
    expect(c.status(r).state).toBe('missing')
    expect(c.failedBundle(r)).toBe(rider)
    expect(c.failedBundle(ref('VST2', '1', 'RoughRider2'))).toBe('')
  })
})

describe('auval (AuvalTest)', () => {
  const OUTPUT =
    '    AU Validation Tool\n\n' +
    'aufx FqEh oDin  -  Valhalla DSP, LLC: ValhallaFreqEcho\n' +
    'aufx Stud AuDa  -  Audio Damage: Rough Rider    Cannot open component: -50\n' +
    'aumu ObsV Artu  -  Arturia: Oberheim SEM V\n'

  test('parse', () => {
    expect(parseAuval(OUTPUT)).toEqual([
      ['aufx', 'FqEh', 'oDin', 'Valhalla DSP, LLC: ValhallaFreqEcho'],
      ['aufx', 'Stud', 'AuDa', 'Audio Damage: Rough Rider'],
      ['aumu', 'ObsV', 'Artu', 'Arturia: Oberheim SEM V'],
    ])
  })

  test('the result is cached until a component changes', async () => {
    const cache = join(tmp.path, 'audio_units.json')
    const old = bundle(join(tmp.path, 'Components', 'Oberheim SEM V.component'), thin(X86_64))
    let calls = 0
    const run = async () => {
      calls++
      return OUTPUT
    }
    const first = await registeredAudioUnits([old], { cachePath: cache, run })
    const second = await registeredAudioUnits([old], { cachePath: cache, run })
    utimesSync(old, new Date(1), new Date(1))
    await registeredAudioUnits([old], { cachePath: cache, run })
    expect(first).toEqual(second)
    expect(calls).toBe(2)
    expect(JSON.parse(readFileSync(cache, 'utf8')).units).toHaveLength(3)
  })

  test('old components are found by name', async () => {
    const root = join(tmp.path, 'Plug-Ins')
    bundle(join(root, 'Components', 'Oberheim SEM V.component'), thin(X86_64)) // no AudioComponents
    const c = await loadInventory(new NodeFs(), {
      database: await readLivePluginDatabase(join(tmp.path, 'none')),
      pluginRoots: [root],
      systemComponents: '',
      registeredAudioUnits: async () => parseAuval(OUTPUT),
    })
    expect(c.status(ref('AU', 'aumu:ObsV:Artu', 'Oberheim SEM V')).state).toBe('rosetta')
    expect(c.status(ref('AU', 'aufx:FqEh:oDin', 'ValhallaFreqEcho')).state).toBe('installed')
  })
})

describe('bundle details (M5)', () => {
  test('versions, and the compatibility a VST3 declares in moduleinfo.json', async () => {
    const root = join(tmp.path, 'Plug-Ins')
    const vst3 = bundle(join(root, 'VST3', 'Serum2.vst3'), fat(X86_64, ARM64), {
      CFBundleShortVersionString: '2.1.5',
    })
    writeFile(
      join(vst3, 'Contents', 'moduleinfo.json'),
      '{"Name": "Serum2", "Classes": [{"CID": "ABCDEF0191827A6B41754461525233F0", "Name": "Serum 2",},],' +
        ' "Compatibility": [{"New": "ABCDEF0191827A6B41754461525233F0", "Old": ["56535458667358736572756D00000000"],},],}',
    )
    bundle(join(root, 'VST', 'Old.vst'), thin(X86_64), { CFBundleVersion: '1.0' })
    const c = await loadInventory(new NodeFs(), {
      database: { plugins: [], modules: [] },
      pluginRoots: [root],
      systemComponents: '',
    })
    expect(c.bundles.get(vst3)).toMatchObject({ format: 'VST3', version: '2.1.5', native: true })
    expect(c.bundles.get(vst3)?.moduleInfo?.classes[0]?.name).toBe('Serum 2')
    expect(c.replacements.get('56535458667358736572756d00000000')).toEqual([
      'abcdef0191827a6b41754461525233f0',
    ])
    expect(c.bundles.get(join(root, 'VST', 'Old.vst'))).toMatchObject({
      version: '1.0',
      native: false,
    })
  })
})
