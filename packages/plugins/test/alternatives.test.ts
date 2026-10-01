/** moduleinfo.json, framework class-id schemes, and the same plug-in in other formats. */
import { describe, expect, test } from 'bun:test'
import type { PluginRef } from '@livesaver/core'
import {
  alternativesOf,
  type BundleInfo,
  type CatalogEntry,
  derivedTarget,
  type InstalledPlugin,
  Inventory,
  juceVst3Uid,
  parseModuleInfo,
  vst2ToVst3Uid,
} from '../src/index.js'

const plugin = (
  format: InstalledPlugin['format'],
  ident: string,
  name: string,
  native = true,
): InstalledPlugin => ({
  format,
  ident,
  name,
  path: `/Library/Audio/Plug-Ins/${format}/${name}`,
  native,
  scanned: true,
})
const ref = (format: PluginRef['format'], ident: string, name: string): PluginRef => ({
  format,
  ident,
  name,
})
const XFSX = 1483109208 // 'XfsX'

describe('moduleinfo.json', () => {
  test('JSON5: comments, trailing commas, single quotes; classes and declared compatibility', () => {
    const info = parseModuleInfo(`{
      // written by the VST3 SDK's moduleinfotool
      "Name": "Serum2",
      "Version": "2.1.5",
      "Factory Info": { "Vendor": 'Xfer Records', },
      "Classes": [
        { "CID": "ABCDEF0191827A6B41754461525233F0", "Category": "Audio Module Class",
          "Name": "Serum 2", "Sub Categories": ["Instrument", "Synth",], },
        { "CID": "not a cid", "Name": "broken" },
      ],
      /* the VST2 version this one replaces */
      "Compatibility": [ { "New": "ABCDEF0191827A6B41754461525233F0", "Old": ["565354586673587365727 56d00000000"], }, ],
    }`)
    expect(info?.name).toBe('Serum2')
    expect(info?.vendor).toBe('Xfer Records')
    expect(info?.classes).toHaveLength(1)
    expect(info?.classes[0]).toMatchObject({
      cid: 'abcdef0191827a6b41754461525233f0',
      name: 'Serum 2',
      subCategories: ['Instrument', 'Synth'],
      vendor: 'Xfer Records',
    })
    expect(info?.compatibility.get('abcdef0191827a6b41754461525233f0')).toEqual([
      '56535458667358736572756d00000000',
    ])
    expect(parseModuleInfo('{ not json')).toBeUndefined()
  })
})

describe('class ids', () => {
  test('JUCE builds its VST3 class id from the AU codes', () => {
    expect(juceVst3Uid('AuDa', 'RRR3')).toBe('abcdef019182faeb4175446152525233')
  })

  test('the name bytes decide between VST3 classes sharing a VST2 id', () => {
    const serum = vst2ToVst3Uid(XFSX, 'Serum')
    const other = vst2ToVst3Uid(XFSX, 'Another')
    const catalog = new Map<string, CatalogEntry>([
      [other, { devIdentifier: 'device:vst3:instr:x', name: 'Another' }],
      [serum, { devIdentifier: 'device:vst3:instr:y', name: 'Serum' }],
    ])
    expect(derivedTarget(XFSX, catalog)?.uid).toBe([other, serum].sort()[0]) // without a name: the first sorted class id
    expect(derivedTarget(XFSX, catalog, 'Serum')?.uid).toBe(serum)
    expect(derivedTarget(XFSX, catalog, 'Serum_x64')?.uid).toBe([other, serum].sort()[0]) // a file name
  })
})

describe('the same plug-in in other formats', () => {
  const serumVst3 = vst2ToVst3Uid(XFSX, 'Serum')
  const roughVst3 = juceVst3Uid('AuDa', 'RRR3')
  const declaredNew = 'abcdef0191827a6b41754461525233f0'
  const bundles = new Map<string, BundleInfo>([
    [
      '/Library/Audio/Plug-Ins/VST3/Serum2.vst3',
      {
        path: '/Library/Audio/Plug-Ins/VST3/Serum2.vst3',
        format: 'VST3',
        version: '2.1.5',
        identifier: '',
        native: true,
        moduleInfo: {
          name: 'Serum2',
          version: '2.1.5',
          vendor: 'Xfer Records',
          classes: [],
          compatibility: new Map([[declaredNew, [serumVst3]]]),
        },
      },
    ],
  ])
  const inventory = new Inventory(
    [
      plugin('VST2', String(XFSX), 'Serum', false),
      plugin('VST3', serumVst3, 'Serum'),
      plugin('AU', 'aumu:XfsX:XFER', 'Xfer Records: Serum'),
      plugin('VST3', declaredNew, 'Serum 2'),
      plugin('AU', 'aufx:RRR3:AuDa', 'Audio Damage: Rough Rider 3'),
      plugin('VST3', roughVst3, 'RoughRider3'),
      plugin('VST2', '42', 'Unrelated'),
    ],
    [],
    bundles,
  )

  test('from a VST2: Steinberg id, declared replacement, AU subtype', () => {
    const alts = alternativesOf(ref('VST2', String(XFSX), 'Serum_x64'), inventory)
    expect(alts.map((a) => [a.format, a.name, a.link, a.native])).toEqual([
      ['VST3', 'Serum 2', 'declared', true],
      ['VST3', 'Serum', 'steinberg', true],
      ['AU', 'Xfer Records: Serum', 'au-code', true],
    ])
  })

  test('from an AU: the VST2 with that id, and the JUCE VST3', () => {
    expect(
      alternativesOf(ref('AU', 'aumu:XfsX:XFER', 'Serum'), inventory).map((a) => [
        a.format,
        a.link,
      ]),
    ).toEqual([
      ['VST3', 'declared'],
      ['VST3', 'steinberg'],
      ['VST2', 'au-code'],
    ])
    expect(
      alternativesOf(ref('AU', 'aufx:RRR3:AuDa', 'Rough Rider 3'), inventory).map((a) => [
        a.name,
        a.link,
      ]),
    ).toEqual([['RoughRider3', 'juce']])
  })

  test('from a VST3: back to the VST2 and AU; nothing for unrelated plug-ins', () => {
    expect(
      alternativesOf(ref('VST3', roughVst3, 'RoughRider3'), inventory).map((a) => [
        a.format,
        a.link,
      ]),
    ).toEqual([['AU', 'juce']])
    expect(alternativesOf(ref('VST2', '7', 'Nothing'), inventory)).toEqual([])
  })
})
