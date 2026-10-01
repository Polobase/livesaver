/** VST2 → VST3 conversion of the Live-saved fixture, the blockers, and plug-in identity. */
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { fixturesDir, readSet } from '@livesaver/test-kit'
import { encodeUtf8, scan } from '@livesaver/xml'
import {
  addCatalogRows,
  type Catalog,
  type CatalogEntry,
  convertText,
  derivedTarget,
  fieldsToUid,
  fourCC,
  KNOWN,
  omnisphereState,
  UNKNOWN_VALUE,
  uidToFields,
  vst2ToVst3Uid,
} from '../src/index.js'

const fixtures = fixturesDir()
const FIXTURE = join(fixtures, 'projects', 'VST2toVST3 Project', 'VST2toVST3.als')

/** The VST3 plug-ins of the fixture Set as Live's plug-in database lists them. */
const CATALOG: Catalog = new Map<string, CatalogEntry>([
  [
    '5653544e694d616d6173736976650000',
    { devIdentifier: 'device:vst3:instr:5653544e-694d-616d-6173-736976650000', name: 'Massive' },
  ],
  [
    '56535458667358736572756d00000000',
    { devIdentifier: 'device:vst3:instr:56535458-6673-5873-6572-756d00000000', name: 'Serum' },
  ],
  [
    '84e8de5f9255222296fae4133c935a18',
    { devIdentifier: 'device:vst3:instr:84e8de5f-9255-2222-96fa-e4133c935a18', name: 'Omnisphere' },
  ],
])

/** PluginDevice text per track name ("5 Massive VST2", …). */
function devices(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of text.matchAll(/<MidiTrack\b[^>]*>[\s\S]*?<\/MidiTrack>/g)) {
    const name = /<EffectiveName Value="([^"]*)"/.exec(m[0])?.[1] as string
    out[name] = /<PluginDevice Id="\d+">[\s\S]*?<\/PluginDevice>/.exec(m[0])?.[0] as string
  }
  return out
}

function children(text: string, tag: string): string[] {
  const inner = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*)</${tag}>`).exec(text)?.[1] ?? ''
  const names: string[] = []
  let depth = 0
  for (const m of inner.matchAll(/<(\/?)([\w.]+)[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = m
    if (closing) {
      depth--
      continue
    }
    if (depth === 0) names.push(name as string)
    if (!selfClosing) depth++
  }
  return names
}

function hexValue(text: string, tag: string): Uint8Array {
  const hex = (new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)?.[1] ?? '').replace(
    /\s+/g,
    '',
  )
  return Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16))
}

const values = (text: string, tag: string) =>
  [...text.matchAll(new RegExp(`<${tag} Value="([^"]*)"`, 'g'))].map((m) => m[1] as string)
const outsideDevices = (text: string) =>
  text.replace(/<PluginDevice Id="\d+">[\s\S]*?<\/PluginDevice>/g, '#')

function minimalSet(
  device: string,
  options: { rack?: boolean; major?: number; minor?: string } = {},
): string {
  const body = options.rack
    ? `<InstrumentGroupDevice Id="7">\n${device}\n</InstrumentGroupDevice>`
    : device
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Ableton MajorVersion="${options.major ?? 5}" MinorVersion="${options.minor ?? '12.0_12400'}" Creator="Ableton Live">\n<LiveSet>\n${body}\n</LiveSet>\n</Ableton>\n`
}

describe('conversion of the fixture', () => {
  const text = readSet(FIXTURE)
  const result = convertText(text, CATALOG)
  const after = devices(result.text as string)
  const before = devices(text)

  function assertLikeLive(vst2Track: string, vst3Track: string): [string, string] {
    const converted = after[vst2Track] as string
    const live = after[vst3Track] as string
    expect(converted).not.toContain('<VstPluginInfo')
    expect(children(converted, 'Vst3PluginInfo')).toEqual(children(live, 'Vst3PluginInfo'))
    expect(children(converted, 'Vst3Preset')).toEqual(children(live, 'Vst3Preset'))
    for (const tag of [
      'Fields.0',
      'Fields.1',
      'Fields.2',
      'Fields.3',
      'DeviceType',
      'BranchDeviceId',
    ]) {
      expect(values(converted, tag)).toEqual(values(live, tag))
    }
    expect(values(converted, 'Name').at(-1)).toBe(values(live, 'Name').at(-1) as string)
    return [converted, live]
  }

  test('all three plug-ins are converted', () => {
    expect(Object.fromEntries(result.outcomes.map((o) => [o.plugin, o.converted]))).toEqual({
      Omnisphere: true,
      Serum: true,
      Massive: true,
    })
    expect(result.unchecked.size).toBe(0)
  })

  test('Massive keeps its state and automation', () => {
    const [converted, live] = assertLikeLive('5 Massive VST2', '6 Massive VST3')
    const state = hexValue(converted, 'ProcessorState')
    expect(state).toEqual(hexValue(before['5 Massive VST2'] as string, 'Buffer'))
    expect(state.length).toBe(hexValue(live, 'ProcessorState').length)
    const old = before['5 Massive VST2'] as string
    expect(converted.slice(converted.indexOf('<ParameterList>'))).toBe(
      old.slice(old.indexOf('<ParameterList>')),
    )
    expect([...converted.matchAll(/<ParameterId Value="(\d+)"/g)].map((m) => m[1])).toEqual([
      '33',
      '9',
    ])
  })

  test("Omnisphere's state is what Live writes", () => {
    const [converted, live] = assertLikeLive('1 Omnisphere VST2', '2 Omnisphere VST3')
    expect(hexValue(converted, 'ProcessorState')).toEqual(hexValue(live, 'ProcessorState'))
    const chunk = hexValue(before['1 Omnisphere VST2'] as string, 'Buffer')
    expect(omnisphereState(chunk)).toEqual(hexValue(live, 'ProcessorState'))
  })

  test('Serum takes the chunk and resets the parameter list', () => {
    const [converted] = assertLikeLive('3 Serum VST2', '4 Serum VST3')
    expect(hexValue(converted, 'ProcessorState')).toEqual(
      hexValue(before['3 Serum VST2'] as string, 'Buffer'),
    )
    const params = converted.slice(
      converted.indexOf('<ParameterList>'),
      converted.indexOf('</ParameterList>'),
    )
    expect(new Set(values(params, 'ParameterName'))).toEqual(new Set(['']))
    expect(new Set(values(params, 'ParameterId'))).toEqual(new Set(['-1']))
    expect(new Set(values(params, 'Manual'))).toEqual(new Set([UNKNOWN_VALUE]))
  })

  test('the rest of the Set is unchanged', () => {
    scan(encodeUtf8(result.text as string), { strict: true })
    expect(outsideDevices(result.text as string)).toBe(outsideDevices(text))
    for (const name of ['2 Omnisphere VST3', '4 Serum VST3', '6 Massive VST3'])
      expect(after[name]).toBe(before[name] as string)
  })

  test('a second run changes nothing', () => {
    const again = convertText(result.text as string, CATALOG)
    expect(again.text).toBeUndefined()
    expect(again.outcomes).toEqual([])
  })

  test('automation blocks an unverified plug-in in the whole Set', () => {
    const serum = before['3 Serum VST2'] as string
    const target = /<AutomationTarget Id="(\d+)"/.exec(
      serum.slice(serum.indexOf('<ParameterList>')),
    )?.[1]
    const envelope = `<AutomationEnvelope Id="99"><EnvelopeTarget><PointeeId Value="${target}" /></EnvelopeTarget></AutomationEnvelope>`
    const withAutomation = text.replace(
      '</LiveSet>',
      `<Envelopes>${envelope}</Envelopes></LiveSet>`,
    )
    const r = convertText(withAutomation, CATALOG)
    const byPlugin = new Map(r.outcomes.map((o) => [o.plugin, o]))
    expect(byPlugin.get('Serum')?.converted).toBe(false)
    expect([...(byPlugin.get('Serum')?.reasons ?? [])]).toEqual([['links', 1]])
    expect(byPlugin.get('Massive')?.converted && byPlugin.get('Omnisphere')?.converted).toBe(true)
    expect(devices(r.text as string)['3 Serum VST2']).toContain('<VstPluginInfo')
  })

  test('only the selected plug-in', () => {
    expect(
      convertText(text, CATALOG, { only: new Set(['massive']) }).outcomes.map((o) => o.plugin),
    ).toEqual(['Massive'])
  })
})

describe('blockers', () => {
  const massive = devices(readSet(FIXTURE))['5 Massive VST2'] as string
  const outcome = (text: string, catalog: Catalog = CATALOG, known = KNOWN) => {
    const r = convertText(text, catalog, { known })
    return { text: r.text, outcome: r.outcomes[0], unchecked: r.unchecked }
  }
  const reasons = (o: ReturnType<typeof outcome>) => Object.fromEntries(o.outcome?.reasons ?? [])

  test('a plain device is converted', () => {
    const r = outcome(minimalSet(massive))
    expect(r.outcome?.converted).toBe(true)
    expect(r.text).toContain('<Vst3PluginInfo')
  })

  test('a device in a rack is skipped', () => {
    const r = outcome(minimalSet(massive, { rack: true }))
    expect(r.text).toBeUndefined()
    expect(reasons(r)).toEqual({ rack: 1 })
  })

  test('file formats without VST3 are skipped', () => {
    for (const [major, minor] of [
      [4, '9.7_1020'],
      [5, '10.0_370'],
    ] as const) {
      const r = outcome(minimalSet(massive, { major, minor }))
      expect(r.text).toBeUndefined()
      expect(reasons(r)).toEqual({ old_format: 1 })
    }
  })

  test('the Live 10.1 format is converted', () => {
    expect(outcome(minimalSet(massive, { minor: '10.0_377' })).outcome?.converted).toBe(true)
  })

  test('a missing VST3 is reported', () => {
    const r = outcome(minimalSet(massive), new Map())
    expect(r.text).toBeUndefined()
    expect(reasons(r)).toEqual({ no_vst3: 1 })
  })

  test('an unknown plug-in with a VST3 is only listed', () => {
    const known = new Map([...KNOWN].filter(([, v]) => v.name !== 'Massive'))
    const r = outcome(minimalSet(massive), CATALOG, known)
    expect(r.text).toBeUndefined()
    expect(r.outcome).toBeUndefined()
    expect(Object.fromEntries(r.unchecked)).toEqual({ Massive: 1 })
  })
})

describe('identity', () => {
  test("reads Live's plug-in rows and finds the derived VST3", () => {
    const catalog = addCatalogRows(new Map(), [
      { devIdentifier: 'device:vst3:instr:5653544e-694d-616d-6173-736976650000', name: 'Massive' },
      { devIdentifier: 'device:vst:instr:1315523937?n=Massive', name: 'Massive' },
    ])
    expect([...catalog.keys()]).toEqual(['5653544e694d616d6173736976650000'])
    const target = derivedTarget(1315523937, catalog)
    expect([target?.name, target?.deviceType]).toEqual(['Massive', 1])
    expect(target?.fields).toEqual([1448301646, 1766678893, 1634956137, 1986330624])
  })

  test("Steinberg's derivation and Live's Uid fields", () => {
    expect(vst2ToVst3Uid(1483109208, 'Serum')).toBe('56535458667358736572756d00000000')
    expect(vst2ToVst3Uid(1315523937, 'Massive')).toBe('5653544e694d616d6173736976650000')
    expect(vst2ToVst3Uid(1483109208, 'Serum', true).slice(0, 6)).toBe('565345')
    expect(uidToFields('ed57bd725c60467ea64dd2f400758b6f')).toEqual([
      -313016974, 1549813374, -1504849164, 7703407,
    ])
    expect(fieldsToUid([-313016974, 1549813374, -1504849164, 7703407])).toBe(
      'ed57bd725c60467ea64dd2f400758b6f',
    )
    expect(fourCC(1483109208)).toBe('XfsX')
  })
})
