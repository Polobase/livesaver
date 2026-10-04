/** Max devices as replacements, and Live's table of content it moved between versions. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  CORE_LIBRARY_PACK_ID,
  type FileRef,
  fileRefs,
  liveCrc,
  REL_PACK,
  remapKey,
} from '@livesaver/core'
import { amxd, deviceSet, docFromText, tempDir, writeFile } from '@livesaver/test-kit'
import { choose, classify, type Environment, Probe, resolveExisting } from '../src/index.js'
import { env, host, index } from './match-kit.js'

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
