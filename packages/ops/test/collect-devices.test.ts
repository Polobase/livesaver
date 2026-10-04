/** collect with --apply in temp dirs: Max for Live devices, which stay where they are or are collected. */
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { liveCrc, REL_PACK, REL_PROJECT, remapKey } from '@livesaver/core'
import {
  amxd,
  deviceSet,
  fixturesDir,
  makeProject,
  oldDeviceSet,
  readSet,
  stripSampleRefs,
  writeFile,
  writeSet,
} from '@livesaver/test-kit'
import { mtimeUs, refsOf, useCollect } from './collect-kit.js'

const _fixtures = fixturesDir()

const { tmp, run } = useCollect()

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
