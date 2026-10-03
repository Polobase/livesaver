/** Resolving references the way Live does, and choosing replacements for missing ones. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { copyFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  CORE_LIBRARY_PACK_ID,
  EMPTY_REMAP,
  type FileRef,
  fileRefs,
  liveCrc,
  openDocument,
  REL_PACK,
  remapKey,
} from '@livesaver/core'
import { createNodeHost } from '@livesaver/node'
import {
  amxd,
  deviceSet,
  docFromText,
  fixturesDir,
  tempDir,
  testCodec,
  writeFile,
} from '@livesaver/test-kit'
import {
  type ChooseOptions,
  choose,
  classify,
  type EnvConfig,
  Environment,
  FileIndex,
  methodText,
  Probe,
  resolveExisting,
} from '../src/index.js'

const fixtures = fixturesDir()
const host = createNodeHost()

function env(config: Partial<EnvConfig> = {}, probe = new Probe(host.fs, host.hash)): Environment {
  return new Environment(
    {
      userLibrary: '',
      factoryPacks: '',
      appResources: '',
      preferredRoots: [],
      vendorLibraries: [],
      remap: EMPTY_REMAP,
      ...config,
    },
    probe,
  )
}

async function index(roots: string[], ignore: string[] = []): Promise<FileIndex> {
  return FileIndex.build(roots, new Probe(host.fs, host.hash), { ignore })
}

async function brokenRef(): Promise<FileRef> {
  const path = join(fixtures, 'projects', 'Brokenpath Project', 'Brokenpath.als')
  const doc = await openDocument(new Uint8Array(readFileSync(path)), testCodec)
  return fileRefs(doc)[0] as FileRef
}

const unknownFingerprint = (ref: FileRef, path: string): FileRef => ({
  ...ref,
  size: 0,
  crc: 0,
  path,
})

function wav(audio: Uint8Array, metadata = ''): Uint8Array {
  const fmt = new Uint8Array(16)
  const f = new DataView(fmt.buffer)
  f.setUint16(0, 1, true)
  f.setUint16(2, 1, true)
  f.setUint32(4, 44100, true)
  f.setUint32(8, 88200, true)
  f.setUint16(12, 2, true)
  f.setUint16(14, 16, true)
  const meta = new TextEncoder().encode(metadata)
  const parts: Uint8Array[] = [
    new TextEncoder().encode('WAVE'),
    chunk('fmt ', fmt),
    chunk('data', audio),
  ]
  if (meta.length) parts.push(chunk('ID3 ', meta))
  return chunk('RIFF', concat(parts))
}

function chunk(id: string, body: Uint8Array): Uint8Array {
  const head = new Uint8Array(8)
  head.set(new TextEncoder().encode(id))
  new DataView(head.buffer).setUint32(4, body.length, true)
  return concat([head, body])
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** What NI did to Maschine samples: append bytes and update the RIFF size field. */
function vendorResave(original: Uint8Array, extra: Uint8Array): Uint8Array {
  const data = concat([original, extra])
  new DataView(data.buffer).setUint32(4, data.length - 8, true)
  return data
}

const bytes = (s: string) => new TextEncoder().encode(s)
const repeat = (s: string, n: number) => bytes(s.repeat(n))

describe('user rule', () => {
  test('longest path ending wins', async () => {
    const samples = join(fixtures, 'samples')
    const ix = await index([samples])
    expect(ix.candidates('1.wav')).toHaveLength(2)
    const c = await choose(
      await brokenRef(),
      ix,
      '/nonexistent/project',
      env(),
      new Probe(host.fs, host.hash),
    )
    expect([c.status, c.path, c.suffix, c.verified]).toEqual([
      'found',
      join(samples, 'Lib1', 'Kick', '1.wav'),
      3,
      true,
    ])
  })

  test('still Lib1 with project copies in the index', async () => {
    const ix = await index([fixtures])
    expect(ix.candidates('1.wav')).toHaveLength(3)
    const c = await choose(
      await brokenRef(),
      ix,
      '/nonexistent/project',
      env(),
      new Probe(host.fs, host.hash),
    )
    expect(c.path).toBe(join(fixtures, 'samples', 'Lib1', 'Kick', '1.wav'))
  })
})

describe('choice', () => {
  let tmp: { path: string; cleanup: () => void }
  beforeEach(() => {
    tmp = tempDir()
  })
  afterEach(() => tmp.cleanup())
  const file = (rel: string, content: Uint8Array) => writeFile(join(tmp.path, rel), content)
  const pick = async (ref: FileRef, e = env(), root = tmp.path, options: ChooseOptions = {}) =>
    choose(ref, await index([tmp.path]), root, e, new Probe(host.fs, host.hash), options)

  test('not found', async () => {
    expect((await pick(await brokenRef())).status).toBe('not-found')
  })

  test('other content is rejected', async () => {
    file('Lib1/Kick/1.wav', bytes('RIFF different sample'))
    const c = await pick(await brokenRef())
    expect([c.status, c.candidates.length]).toEqual(['mismatch', 1])
  })

  test('pack sample needs only the same size', async () => {
    file('Drum Essentials/Kick/1.wav', repeat('x', 2000324))
    const c = await pick({ ...(await brokenRef()), packName: 'Drum Essentials' })
    expect([c.status, c.verified, c.sizeOnly]).toEqual(['found', false, true])
    expect(methodText(c).startsWith('same size only')).toBe(true)
  })

  test('vendor library file that grew slightly', async () => {
    const original = new Uint8Array(
      readFileSync(join(fixtures, 'samples', 'Lib1', 'Kick', '1.wav')),
    )
    file('NI/Kick Library/Samples/Kick/1.wav', vendorResave(original, new Uint8Array(1)))
    const c = await pick(await brokenRef(), env({ vendorLibraries: [join(tmp.path, 'NI')] }))
    expect([c.status, c.verified, c.vendorUpdate]).toEqual(['found', true, true])
    expect((await pick(await brokenRef())).status).toBe('mismatch') // not trusted outside a vendor library
  })

  describe('library file with other tags (matchLibraryPath)', () => {
    const SHAKER = 'Samples/Drums/Shaker/Shaker 1.wav'
    const audio = repeat('\x01\x02\x03', 400)
    // Shorter than Live's 16 KB CRC window, so the tags are part of the fingerprint.
    const old = wav(audio, 'library 1.0')
    const installed = wav(audio, 'library 1.1!')
    const ni = () => env({ vendorLibraries: [join(tmp.path, 'NI')] })
    const shaker = async (
      path = `E:\\Maschine Library\\Drum Library\\${SHAKER}`,
    ): Promise<FileRef> => ({
      ...(await brokenRef()),
      name: 'Shaker 1.wav',
      path,
      hintPath: '',
      relPath: '',
      size: old.length,
      crc: liveCrc(old),
    })
    const on = { matchLibraryPath: true }

    test('accepted by name and place in the library, unverified', async () => {
      const path = file(`NI/Drum Library/${SHAKER}`, installed)
      expect(installed.length - old.length).toBe(1)
      expect((await pick(await shaker(), ni())).status).toBe('mismatch') // off by default
      const c = await pick(await shaker(), ni(), tmp.path, on)
      expect([c.status, c.path, c.suffix]).toEqual(['found', path, 5])
      expect([c.verified, c.vendorUpdate, c.sizeOnly, c.libraryPath]).toEqual([
        false,
        false,
        false,
        true,
      ])
      expect(methodText(c)).toBe(
        'name and library path only (other fingerprint), path end 5 level(s)',
      )
    })

    test('a library whose top folder was renamed still counts', async () => {
      file(`NI/Drum Library 2/${SHAKER}`, installed)
      const c = await pick(await shaker(), ni(), tmp.path, on)
      expect([c.status, c.suffix]).toEqual(['found', 4])
    })

    test('not for another size, another place, other folders, or Max devices', async () => {
      file(`NI/Drum Library/${SHAKER}`, wav(repeat('\x01\x02\x03', 406), 'library 1.1')) // 18 bytes more
      expect((await pick(await shaker(), ni(), tmp.path, on)).status).toBe('mismatch')
      rmSync(join(tmp.path, 'NI'), { recursive: true })

      file('NI/Drum Library/Samples/Other/Shaker/Shaker 1.wav', installed) // two levels match
      expect((await pick(await shaker(), ni(), tmp.path, on)).status).toBe('mismatch')
      rmSync(join(tmp.path, 'NI'), { recursive: true })

      file(`NI/Drum Library/${SHAKER}`, installed)
      expect((await pick(await shaker(), env(), tmp.path, on)).status).toBe('mismatch') // no vendor library
      const device: FileRef = { ...(await shaker()), kind: 'device' }
      expect((await pick(device, ni(), tmp.path, on)).status).toBe('mismatch')
    })

    test('a file with the right fingerprint wins', async () => {
      file(`NI/Drum Library/${SHAKER}`, installed)
      const exact = file('Old Disk/Shaker 1.wav', old)
      const c = await pick(await shaker(), ni(), tmp.path, on)
      expect([c.status, c.path, c.verified, c.libraryPath]).toEqual(['found', exact, true, false])
    })

    test('two libraries with different audio are ambiguous, with the same audio found', async () => {
      file(`NI/Drum Library 2/${SHAKER}`, installed)
      file(`NI/Drum Selection/${SHAKER}`, wav(repeat('\x03\x02\x01', 400), 'library 1.1!'))
      const c = await pick(await shaker(), ni(), tmp.path, on)
      expect([c.status, c.candidates.length]).toEqual(['ambiguous', 2])
      file(`NI/Drum Selection/${SHAKER}`, wav(audio, 'selection 1'))
      expect((await pick(await shaker(), ni(), tmp.path, on)).status).toBe('found')
    })
  })

  test('audio hash ignores metadata', async () => {
    const probe = new Probe(host.fs, host.hash)
    const a = file('a.wav', wav(repeat('\x01\x02', 100), 'Maschine 2 Factory Library'))
    const b = file('b.wav', wav(repeat('\x01\x02', 100), 'Maschine 2 Factory Selection'))
    const c = file('c.wav', wav(repeat('\x02\x01', 100), 'Maschine 2 Factory Library'))
    expect(await probe.audioHash(a)).toBe(await probe.audioHash(b))
    expect(await probe.audioHash(a)).not.toBe(await probe.audioHash(c))
  })

  test('tie with the same audio but other metadata is found', async () => {
    file('Library/Samples/Kick/1.wav', wav(repeat('\x01\x02', 100), 'Library'))
    file('Selection/Samples/Kick/1.wav', wav(repeat('\x01\x02', 100), 'Selectn'))
    const ref = unknownFingerprint(await brokenRef(), 'E:\\Maschine Library\\Samples\\Kick\\1.wav')
    expect((await pick(ref)).status).toBe('found')
  })

  test('same-size candidate from an installed pack', async () => {
    file('Packs/Latin Percussion/Samples/1.wav', repeat('x', 2000324))
    const c = await pick(await brokenRef(), env({ factoryPacks: join(tmp.path, 'Packs') }))
    expect([c.status, c.sizeOnly]).toEqual(['found', true])
  })

  test('leading spaces in file names', async () => {
    const path = file('SP - Space Pack/SP_Hi_Hat_132/  SP_Hi_Hat_9_707.wav', bytes('x'))
    expect((await index([tmp.path])).candidates('SP_Hi_Hat_9_707.wav')).toEqual([path])
  })

  test('ignored folders are not searched', async () => {
    file('Libraries/Unlicensed/1.wav', bytes('x'))
    file('Libraries/Other/1.wav', bytes('y'))
    const ix = await index([tmp.path], [join(tmp.path, 'Libraries', 'Unlicensed')])
    expect(ix.candidates('1.wav')).toEqual([join(tmp.path, 'Libraries', 'Other', '1.wav')])
  })

  test('own sample with the same size but another CRC is rejected', async () => {
    file('Lib1/Kick/1.wav', repeat('x', 2000324))
    expect((await pick(await brokenRef())).status).toBe('mismatch')
  })

  test('content beats path', async () => {
    file('Lib1/Kick/1.wav', bytes('RIFF edited later'))
    const other = file('Other/1.wav', new Uint8Array())
    copyFileSync(join(fixtures, 'samples', 'Lib2', 'Kick', '1.wav'), other)
    const c = await pick(await brokenRef())
    expect([c.status, c.path]).toEqual(['found', other])
  })

  test('tie with different content is ambiguous', async () => {
    file('Lib1/Kick/1.wav', bytes('one'))
    file('Lib2/Kick/1.wav', bytes('two'))
    const c = await pick(unknownFingerprint(await brokenRef(), '/old/disk/Lib3/Kick/1.wav'))
    expect([c.status, c.suffix, c.candidates.length]).toEqual(['ambiguous', 2, 2])
  })

  test('tie with identical content prefers the own project', async () => {
    file('Lib/Kick/1.wav', bytes('same'))
    const inProject = file('My Project/Samples/Kick/1.wav', bytes('same'))
    const ref = unknownFingerprint(await brokenRef(), '/old/disk/Kick/1.wav')
    const c = await pick(ref, env(), join(tmp.path, 'My Project'))
    expect([c.status, c.path]).toEqual(['found', inProject])
  })

  test('Windows path and case', async () => {
    file('lib1/KICK/1.wav', bytes('x'))
    file('Lib2/Kick/1.wav', bytes('y'))
    const c = await pick(unknownFingerprint(await brokenRef(), 'E:\\Samples\\Lib1\\Kick\\1.wav'))
    expect([c.status, c.path]).toEqual(['found', join(tmp.path, 'lib1', 'KICK', '1.wav')])
  })
})

describe('Max devices', () => {
  let tmp: { path: string; cleanup: () => void }
  beforeEach(() => {
    tmp = tempDir()
  })
  afterEach(() => tmp.cleanup())

  async function deviceRef(
    data: Uint8Array,
    options: { packName?: string } = {},
  ): Promise<FileRef> {
    const path = 'E:\\Ableton\\Factory Packs\\Max for Live Essentials\\Max Audio Effect\\LFO.amxd'
    const [ref] = fileRefs(await docFromText(deviceSet(path, data.length, liveCrc(data), options)))
    return ref as FileRef
  }
  const pick = async (ref: FileRef, e = env()) =>
    choose(ref, await index([tmp.path]), tmp.path, e, new Probe(host.fs, host.hash))

  test('same size, other CRC is rejected even from a pack', async () => {
    const ref = await deviceRef(amxd('aaaa', '1'), { packName: 'Max for Live Essentials' })
    writeFile(join(tmp.path, 'Packs', 'Some Pack', 'LFO.amxd'), amxd('aaaa', '2'))
    expect((await pick(ref, env({ factoryPacks: join(tmp.path, 'Packs') }))).status).toBe(
      'mismatch',
    )
  })

  test('exact fingerprint is found', async () => {
    const ref = await deviceRef(amxd('aaaa', '1'))
    const copy = writeFile(join(tmp.path, 'Old Project', 'LFO.amxd'), amxd('aaaa', '1'))
    const c = await pick(ref)
    expect([c.status, c.path, c.verified]).toEqual(['found', copy, true])
  })

  test('without fingerprint all candidates must be identical', async () => {
    const ref = { ...(await deviceRef(amxd())), size: 0, crc: 0 }
    writeFile(join(tmp.path, 'A', 'Max Audio Effect', 'LFO.amxd'), amxd('aaaa', '1'))
    writeFile(join(tmp.path, 'B', 'LFO.amxd'), amxd('aaaa', '2'))
    expect((await pick(ref)).status).toBe('ambiguous')
  })
})

describe("Live's remap table", () => {
  let tmp: { path: string; cleanup: () => void }
  let app: string
  let builtin: string
  let e: Environment
  beforeEach(() => {
    tmp = tempDir()
    app = join(tmp.path, 'App-Resources')
    builtin = writeFile(
      join(
        app,
        'Builtin/Devices/MIDI Effects/Expression Control/Legacy/Ableton Folder Info/Expression Control Legacy.amxd',
      ),
      amxd('mmmm'),
    )
    const mapping = new Map<string, readonly [number, string, string]>([
      [
        remapKey(
          5,
          'www.ableton.com/0',
          'Devices/Midi Effects/Max Midi Effect/Expression Control.amxd',
        ),
        [
          7,
          '',
          'Devices/MIDI Effects/Expression Control/Ableton Folder Info/Expression Control.amxd',
        ],
      ],
      [
        remapKey(
          7,
          '',
          'Devices/MIDI Effects/Expression Control/Ableton Folder Info/Expression Control.amxd',
        ),
        [
          7,
          '',
          'Devices/MIDI Effects/Expression Control/Legacy/Ableton Folder Info/Expression Control Legacy.amxd',
        ],
      ],
    ])
    e = env({ appResources: app, remap: { mapping, packNames: new Map() } })
  })
  afterEach(() => tmp.cleanup())

  test('the chain is followed to the built-in device', async () => {
    const path =
      '/Applications/Ableton Live 10 Suite.app/Contents/App-Resources/Core Library/Devices/Midi Effects/Max Midi Effect/Expression Control.amxd'
    const [ref] = fileRefs(
      await docFromText(
        deviceSet(path, 1234, 5678, {
          relType: REL_PACK,
          relPath: 'Devices/Midi Effects/Max Midi Effect/Expression Control.amxd',
          packName: 'Core Library',
          packId: CORE_LIBRARY_PACK_ID,
        }),
      ),
    )
    const project = join(tmp.path, 'Ten Project')
    const found = await resolveExisting(
      ref as FileRef,
      project,
      project,
      e,
      new Probe(host.fs, host.hash),
    )
    expect(found).toBe(builtin)
    expect(classify(found as string, project, e)).toBe('builtin')
  })

  test('no entry stays missing', async () => {
    const [ref] = fileRefs(
      await docFromText(deviceSet('/Volumes/NO NAME/LFO.amxd', 1, 2, { relPath: '../LFO.amxd' })),
    )
    expect(
      await resolveExisting(ref as FileRef, tmp.path, tmp.path, e, new Probe(host.fs, host.hash)),
    ).toBeUndefined()
    expect(env().remapped(5, 'www.ableton.com/0', 'x.amxd')).toBe('')
  })

  test('other app files count as built-in', () => {
    const misc = writeFile(join(app, 'Misc', 'Max Devices', 'Max Audio Effect.amxd'), amxd())
    expect(classify(misc, join(tmp.path, 'Some Project'), e)).toBe('builtin')
    rmSync(misc)
  })
})
