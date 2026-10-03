/** The plug-ins of a set, read from its plug-in devices alone: equal to the full analysis. */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { docFromText, fixturesDir, KICKSTART, liveSet, SERUM, testCodec } from '@livesaver/test-kit'
import { analyzeSet, openDocument, pluginUses, pluginUsesOf } from '../src/index.js'

const MASSIVE_VST3 =
  '<PluginDevice Id="2"><PluginDesc><Vst3PluginInfo Id="0"><Preset><Name Value="x" /></Preset>' +
  '<Name Value="Massive" /><Uid><Fields.0 Value="1448301646" /><Fields.1 Value="1766678893" />' +
  '<Fields.2 Value="1634956137" /><Fields.3 Value="1986330624" /></Uid></Vst3PluginInfo>' +
  '</PluginDesc></PluginDevice>'
const SERUM_AU =
  '<AuPluginDevice Id="4"><PluginDesc><AuPluginInfo Id="0"><ComponentType Value="1635085685" />' +
  '<ComponentSubType Value="1483109208" /><ComponentManufacturer Value="1481000274" />' +
  '<Name Value="Serum" /></AuPluginInfo></PluginDesc></AuPluginDevice>'

const both = async (plugins: string) => {
  const doc = await docFromText(liveSet('', { plugins }))
  return { fast: pluginUses(doc), full: analyzeSet(doc).plugins }
}

describe('the plug-ins of a set without scanning the whole set', () => {
  test('every format, counted per plug-in, VST devices before Audio Units', async () => {
    const { fast, full } = await both(SERUM_AU + SERUM + MASSIVE_VST3 + SERUM + KICKSTART)
    expect(fast).toEqual([
      { ref: { format: 'VST2', ident: '1483109208', name: 'Serum' }, instances: 2 },
      {
        ref: { format: 'VST3', ident: '5653544e694d616d6173736976650000', name: 'Massive' },
        instances: 1,
      },
      { ref: { format: 'VST2', ident: '1265200243', name: 'Kickstart-64bit' }, instances: 1 },
      { ref: { format: 'AU', ident: 'aumu:XfsX:XFER', name: 'Serum' }, instances: 1 },
    ])
    expect(fast).toEqual([...full])
  })

  test('a device in a rack, in an attribute-rich tag, or with entities in its name', async () => {
    const named = SERUM.replace('Value="Serum"', 'Value="Tom &amp; &quot;Jerry&quot;"')
    const spaced = KICKSTART.replace('<PluginDevice Id="2">', '<PluginDevice\n\tId="2"  >')
    const rack = `<InstrumentGroupDevice Id="9"><Branches><Devices>${named}</Devices></Branches></InstrumentGroupDevice>`
    const { fast, full } = await both(rack + spaced)
    expect(fast.map((p) => p.ref.name)).toEqual(['Tom & "Jerry"', 'Kickstart-64bit'])
    expect(fast).toEqual([...full])
  })

  test('what only looks like a plug-in device is none', async () => {
    const { fast, full } = await both(
      '<PluginDevice Id="1" />' + // an empty one
        '<PluginDevice Id="2"><PluginDesc /></PluginDevice>' + // one that names no plug-in
        '<MxPluginDevice Id="3"><PluginDesc><VstPluginInfo Id="0"><PlugName Value="No" />' +
        '<UniqueId Value="1" /></VstPluginInfo></PluginDesc></MxPluginDevice>' +
        '<PluginDeviceList Id="4" />' +
        '<PluginDevice Id="5"><PluginDesc><VstPluginInfo Id="0"><PlugName Value="NaN" />' +
        '<UniqueId Value="twelve" /></VstPluginInfo></PluginDesc></PluginDevice>' +
        SERUM,
    )
    expect(fast).toEqual([
      { ref: { format: 'VST2', ident: '1483109208', name: 'Serum' }, instances: 1 },
    ])
    expect(fast).toEqual([...full])
  })

  test('a set without plug-ins', async () => {
    expect((await both('')).fast).toEqual([])
  })

  test('a device that is cut off is an error, and then nothing is said about plug-ins', async () => {
    const cut = liveSet('', { plugins: SERUM }).replace('</PluginDevice>', '')
    const doc = await docFromText(cut)
    expect(() => pluginUses(doc)).toThrow('not closed')
    expect(pluginUsesOf(doc)).toEqual({})
    const nested = liveSet('', {
      plugins: SERUM.replace('<PluginDesc>', `${KICKSTART}<PluginDesc>`),
    })
    expect(pluginUsesOf(await docFromText(nested))).toEqual({})
  })

  test('the set Live saved with VST2 and VST3 devices', async () => {
    const path = join(fixturesDir(), 'projects', 'VST2toVST3 Project', 'VST2toVST3.als')
    const doc = await openDocument(new Uint8Array(readFileSync(path)), testCodec)
    const fast = pluginUses(doc)
    expect(fast.length).toBeGreaterThan(1)
    expect(fast).toEqual([...analyzeSet(doc).plugins])
  })
})
