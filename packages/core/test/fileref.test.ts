/** Live's CRC; parsing FileRefs (Live 9–12, Mac aliases, Windows paths); patching them. */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  deviceSet,
  docFromText,
  fixturesDir,
  LIVE9_SET,
  OLD_SET,
  oldDeviceSet,
  testCodec,
  WINDOWS_PATH,
} from '@livesaver/test-kit'
import { encodeUtf8, patch, scan } from '@livesaver/xml'
import {
  crc16umts,
  decodeData,
  type FileRef,
  fileRefs,
  type LiveDoc,
  liveCrc,
  openDocument,
  patchNew,
  patchOld,
  REL_DOCUMENT,
  REL_PROJECT,
  RelPathIds,
} from '../src/index.js'

const MAC_ALIAS_HEX = `
00000000016000020000034844440000000000000000000000000000000000000000000000000000
000042440001FFFFFFFF0B4B69636B2030372E776176000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000FFFFFFFF0000
00000000000000000000FFFFFFFF00000A2063750000000000000000000000000008496D706F7274
65640002003F2F3A55736572733A736F6D656F6E653A4D757369633A44656D6F2050726F6A656374
3A53616D706C65733A496D706F727465643A4B69636B2030372E77617600000E0018000B004B0069
0063006B002000300037002E007700610076000F000800030048004400440012003D55736572732F
736F6D656F6E652F4D757369632F44656D6F2050726F6A6563742F53616D706C65732F496D706F72
7465642F4B69636B2030372E77617600001300012F0000150002000FFFFF0000`

const fixtures = fixturesDir()

async function readSet(path: string): Promise<LiveDoc> {
  return openDocument(new Uint8Array(readFileSync(path)), testCodec)
}

describe('CRC', () => {
  test('check value', () => {
    expect(crc16umts(encodeUtf8('123456789'))).toBe(0xfee8)
  })

  test('matches the value stored by Live', () => {
    const data = readFileSync(join(fixtures, 'samples', 'Lib1', 'Kick', '1.wav'))
    expect([data.length, liveCrc(new Uint8Array(data.subarray(0, 16384)))]).toEqual([
      2000324, 17226,
    ])
  })
})

describe('parse', () => {
  test('new format fixture', async () => {
    const doc = await readSet(join(fixtures, 'projects', 'Brokenpath Project', 'Brokenpath.als'))
    const refs = fileRefs(doc)
    expect(refs).toHaveLength(4)
    for (const ref of refs) {
      expect(ref.format).toBe('new')
      expect(ref.relType).toBe(REL_DOCUMENT)
      expect(ref.relPath).toBe('../../samples/brokenpath/Lib1/Kick/1.wav')
      expect(ref.path.endsWith('/fixtures/samples/brokenpath/Lib1/Kick/1.wav')).toBe(true)
      expect([ref.name, ref.size, ref.crc, ref.lastMod]).toEqual([
        '1.wav',
        2000324,
        17226,
        '1575302731',
      ])
    }
  })

  test('old format, Live 10', async () => {
    const [ref, ...rest] = fileRefs(await docFromText(OLD_SET))
    expect(rest).toHaveLength(0)
    expect(ref?.format).toBe('old')
    expect(ref?.relDirs).toEqual(['..', 'Other Project', 'Samples', 'Imported'])
    expect(ref?.path).toBe(WINDOWS_PATH)
    expect(ref?.hintPath).toBe('/Samples/Lib1/Kick/1.wav')
    expect([ref?.name, ref?.size, ref?.crc]).toEqual(['1.wav', 2000324, 17226])
  })

  test('old format, Live 9 without relative path', async () => {
    const [ref] = fileRefs(await docFromText(LIVE9_SET))
    expect(ref?.relDirs).toEqual([])
    expect(ref?.name).toBe('Rock & Roll.wav')
    expect(ref?.hintPath).toBe('/Users/someone/Rock & Roll.wav')
    expect([ref?.size, ref?.crc]).toEqual([0, 0])
  })

  test('decodes a Mac alias', () => {
    expect(decodeData(MAC_ALIAS_HEX)).toBe(
      '/Users/someone/Music/Demo Project/Samples/Imported/Kick 07.wav',
    )
  })

  test('SampleRef with Id', async () => {
    expect(
      fileRefs(await docFromText(OLD_SET.replace('<SampleRef>', '<SampleRef Id="1">'))),
    ).toHaveLength(1)
  })

  test('Max device, new format', async () => {
    const path =
      '/Volumes/NO NAME/Stick Project/Presets/Audio Effects/Max Audio Effect/Imported/LFO.amxd'
    const text = deviceSet(path, 502829, 42857, { relPath: `../../..${path}` })
    const [ref] = fileRefs(await docFromText(text))
    expect([ref?.kind, ref?.format, ref?.name, ref?.path]).toEqual([
      'device',
      'new',
      'LFO.amxd',
      path,
    ])
    expect([ref?.size, ref?.crc, ref?.lastMod]).toEqual([502829, 42857, '1588076908'])
    const [sample] = fileRefs(await docFromText(text.replaceAll('MxPatchRef', 'SampleRef')))
    expect(sample?.kind).toBe('sample')
    expect(sample?.key).not.toBe(ref?.key)
  })

  test('Max device, old format (Live 10)', async () => {
    const [ref] = fileRefs(await docFromText(oldDeviceSet(502829, 42857)))
    expect([ref?.kind, ref?.format, ref?.name]).toEqual(['device', 'old', 'LFO.amxd'])
    expect(ref?.relDirs).toEqual([
      '..',
      'Other Project',
      'Presets',
      'Audio Effects',
      'Max Audio Effect',
      'Imported',
    ])
    expect(ref?.hintPath).toBe(
      '/Users/someone/Other Project/Presets/Audio Effects/Max Audio Effect/Imported/LFO.amxd',
    )
    expect([ref?.size, ref?.crc]).toEqual([502829, 42857])
  })

  test('other FileRefs are not parsed', async () => {
    const text = deviceSet('/x/LFO.amxd', 1, 2).replaceAll('MxPatchRef', 'OriginalFileRef')
    expect(fileRefs(await docFromText(text))).toEqual([])
  })

  test('gzipped documents decode the same', async () => {
    expect(fileRefs(await docFromText(OLD_SET, true))).toHaveLength(1)
  })
})

/** Replace the single ref's body, re-scan strictly and re-parse. */
async function patchSingle(text: string, fn: (body: string, ref: FileRef, doc: LiveDoc) => string) {
  const doc = await docFromText(text)
  const [ref] = fileRefs(doc) as [FileRef]
  const body = doc.index.slice(ref.bodySpan)
  const { bytes } = patch(doc.index)
    .replaceRange(ref.bodySpan.start, ref.bodySpan.end, fn(body, ref, doc))
    .applyChecked()
  const newText = new TextDecoder().decode(bytes)
  const [newRef] = fileRefs(await docFromText(newText)) as [FileRef]
  return { newText, ref: newRef }
}

describe('patch', () => {
  test('patch new', async () => {
    const doc = await readSet(join(fixtures, 'projects', 'Brokenpath Project', 'Brokenpath.als'))
    const [ref] = fileRefs(doc) as [FileRef]
    const body = patchNew(
      doc.index.slice(ref.bodySpan),
      REL_PROJECT,
      'Samples/Imported/É & B.wav',
      '/x/Samples/Imported/É & B.wav',
    )
    expect(body).toContain('<RelativePathType Value="3" />')
    expect(body).toContain('<RelativePath Value="Samples/Imported/É &amp; B.wav" />')
    expect(body).toContain('<Path Value="/x/Samples/Imported/É &amp; B.wav" />')
    expect(body).toContain('<OriginalCrc Value="17226" />')
  })

  test('patch old, Live 10: reuses and allocates Ids', async () => {
    const ids = RelPathIds.of(await docFromText(OLD_SET))
    const dirs = ['Users', 'me', 'Old Project', 'Samples', 'Imported']
    const { newText, ref } = await patchSingle(OLD_SET, (body) =>
      patchOld(body, REL_PROJECT, ['Samples', 'Imported'], '1.wav', dirs, ids),
    )
    expect(newText).toContain(
      '<RelativePathElement Id="239" Dir="Samples" />\n\t\t\t\t\t<RelativePathElement Id="240" Dir="Imported" />\n\t\t\t\t</RelativePath>',
    )
    expect(newText).toContain('<RelativePathElement Id="27" Dir="Old Project" />')
    expect(newText).toContain('<RelativePathElement Id="243" Dir="Samples" />')
    expect(newText).toContain('<RelativePathElement Id="244" Dir="Imported" />')
    expect([ref.relType, ref.relDirs, ref.name]).toEqual([3, ['Samples', 'Imported'], '1.wav'])
    expect(ref.hintPath).toBe('/Users/me/Old Project/Samples/Imported/1.wav')
    expect(ref.path).toBe(WINDOWS_PATH)
  })

  test('patch old, Live 9: no Ids', async () => {
    const ids = RelPathIds.of(await docFromText(LIVE9_SET))
    const { newText, ref } = await patchSingle(LIVE9_SET, (body) =>
      patchOld(
        body,
        REL_PROJECT,
        ['Samples', 'Imported'],
        'Rock & Roll.wav',
        ['Users', 'me', 'P Project', 'Samples', 'Imported'],
        ids,
      ),
    )
    expect(newText).not.toContain(' Id=')
    expect(newText).toContain('<HasRelativePath Value="true" />')
    expect(newText).toContain('<Name Value="Rock &amp; Roll.wav" />')
    expect([ref.relType, ref.relPath]).toEqual([3, 'Samples/Imported/Rock & Roll.wav'])
  })

  test('RelPathIds: Live 10 creator uses Ids even without any', async () => {
    const live10 = LIVE9_SET.replace(
      'Creator="Ableton Live 9.1.1"',
      'Creator="Ableton Live 10.0.1"',
    )
    const ids = RelPathIds.of(await docFromText(live10))
    expect(ids.usesIds).toBe(true)
    expect(ids.take()).toBe(0)
    expect(RelPathIds.of(await docFromText(LIVE9_SET)).usesIds).toBe(false)
  })

  test('untouched bytes stay identical after a patch', async () => {
    const doc = await docFromText(OLD_SET)
    const [ref] = fileRefs(doc) as [FileRef]
    const out = patch(doc.index).replaceRange(ref.bodySpan.start, ref.bodySpan.end, 'X').apply()
    const before = doc.xml
    expect(out.subarray(0, ref.bodySpan.start)).toEqual(before.subarray(0, ref.bodySpan.start))
    expect(out.subarray(ref.bodySpan.start + 1)).toEqual(before.subarray(ref.bodySpan.end))
    expect(scan(out).count).toBeGreaterThan(0)
  })
})
