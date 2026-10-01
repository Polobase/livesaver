/** Set analysis: clips, 8-bar blocks, automation, tracks, plug-ins, the content hash. */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  audioClip,
  audioTrack,
  automation,
  docFromText,
  fixturesDir,
  liveSet,
  midiClip,
  midiTrack,
  testCodec,
} from '@livesaver/test-kit'
import {
  analyzeSet,
  fourcc,
  openDocument,
  type PluginRef,
  pluginCode,
  type SetInfo,
} from '../src/index.js'

const analyze = async (text: string) => analyzeSet(await docFromText(text))
const instances = (info: SetInfo, ref: PluginRef) =>
  info.plugins.find(
    (p) => p.ref.format === ref.format && p.ref.ident === ref.ident && p.ref.name === ref.name,
  )?.instances

describe('clips (ClipsTest)', () => {
  test('arrangement and session clips', async () => {
    const track = midiTrack({
      arrangement: [midiClip(0, 32), midiClip(32, 64), midiClip(64, 128, { disabled: true })],
      session: [midiClip(0, 4), '', midiClip(0, 8)],
      freeze: [audioClip(0, 256)],
      takes: [midiClip(0, 512)],
    })
    const info = await analyze(
      liveSet(`${track}<ReturnTrack Id="3"><Name><UserName Value="" /></Name></ReturnTrack>`, {
        scenes: 3,
      }),
    )
    expect([info.arrangementClips, info.arrangementTracks]).toEqual([2, 1]) // not disabled/frozen/takes
    expect([info.start, info.end, info.bars, info.seconds]).toEqual([0, 64, 16, 32])
    expect([info.sessionClips, info.scenesUsed, info.scenes]).toEqual([2, 2, 3])
    expect([info.tracks.MidiTrack, info.tracks.ReturnTrack, info.contentTracks]).toEqual([1, 1, 1])
    expect(info.hasArrangement).toBe(true)
    expect(info.empty).toBe(false)
    expect([info.major, info.version]).toEqual([12, '12.4'])
  })

  test('length starts at the first clip', async () => {
    const info = await analyze(
      liveSet(midiTrack({ arrangement: [midiClip(96, 160)] }), { tempo: 90 }),
    )
    expect([info.startBar, info.bars, info.seconds]).toEqual([25, 16, (64 * 60) / 90])
  })

  test('session only and empty', async () => {
    const session = await analyze(liveSet(midiTrack({ session: [midiClip(0, 4)] })))
    expect(session.hasArrangement).toBe(false)
    expect([session.seconds, session.blocks]).toEqual([0, 0])
    expect((await analyze(liveSet(midiTrack()))).empty).toBe(true)
  })

  test('distinct blocks show a stretched loop', async () => {
    // 8 blocks of 8 bars: A alone, A+B twice, A alone again → 2 different combinations
    const tracks = midiTrack({ arrangement: [midiClip(0, 256)] }) + audioTrack([audioClip(64, 128)])
    const info = await analyze(liveSet(tracks))
    expect([info.blocks, info.distinctBlocks]).toEqual([8, 2])
  })

  test('time signature and the Live 10 master', async () => {
    const info = await analyze(
      liveSet(midiTrack({ arrangement: [midiClip(0, 24)] }), {
        major: 10,
        signature: 200,
        scenes: 4,
      }),
    )
    expect(info.signature).toEqual([3, 4])
    expect([info.bars, info.scenes]).toEqual([8, 4])
    const sixEight = await analyze(
      liveSet(midiTrack({ arrangement: [midiClip(0, 24)] }), { signature: 302 }),
    )
    expect([sixEight.signature, sixEight.beatsPerBar]).toEqual([[6, 8], 3])
  })
})

describe('automation (AutomationTest)', () => {
  test('envelopes with a real event', async () => {
    const track = midiTrack({
      arrangement: [midiClip(0, 4)],
      envelopes: automation(2) + automation(1, false),
    })
    expect((await analyze(liveSet(track))).automated).toBe(2) // master tempo default is no automation
  })

  test('Live 9 parameter automation', async () => {
    const volume =
      '<Mixer><Volume><ArrangerAutomation><Events><FloatEvent Time="-63072000" Value="1" />' +
      '<FloatEvent Time="8" Value="0.5" /></Events></ArrangerAutomation><Manual Value="1" /></Volume>' +
      '<Pan><ArrangerAutomation><Events><FloatEvent Time="-63072000" Value="0" /></Events>' +
      '</ArrangerAutomation></Pan></Mixer>'
    const info = await analyze(
      liveSet(midiTrack({ arrangement: [midiClip(0, 4)], extra: volume }), { major: 9 }),
    )
    expect(info.automated).toBe(1) // the clip container is no automation, the pan has no real event
    expect(info.arrangementClips).toBe(1)
  })
})

describe('details (DetailsTest)', () => {
  test('track names, locators, master chain', async () => {
    const tracks =
      midiTrack({ userName: 'Bass' }) + midiTrack({ userName: '7-Audio' }) + midiTrack()
    const locators =
      '<Locator Id="1"><Time Value="64" /><Name Value="Drop" /></Locator>' +
      '<Locator Id="0"><Time Value="0" /><Name Value="Intro" /></Locator>'
    const rack =
      '<AudioEffectGroupDevice Id="1"><Branches><AudioEffectBranch><DeviceChain><AudioToAudioDeviceChain>' +
      '<Devices><Limiter Id="2" /></Devices></AudioToAudioDeviceChain></DeviceChain></AudioEffectBranch>' +
      '</Branches></AudioEffectGroupDevice>'
    const info = await analyze(
      liveSet(tracks, { locators, masterDevices: `<GlueCompressor Id="0" />${rack}` }),
    )
    expect(info.namedTracks).toBe(1)
    expect(info.locators).toEqual(['Intro', 'Drop'])
    expect(info.masterDevices).toEqual(['GlueCompressor', 'Limiter'])
  })

  test('plug-ins', async () => {
    const plugins =
      '<PluginDevice Id="1"><PluginDesc><VstPluginInfo Id="0"><PlugName Value="Serum" />' +
      '<UniqueId Value="1483109208" /></VstPluginInfo></PluginDesc></PluginDevice>' +
      '<PluginDevice Id="2"><PluginDesc><Vst3PluginInfo Id="0"><Preset><Name Value="x" /></Preset>' +
      '<Name Value="Massive" /><Uid><Fields.0 Value="1448301646" /><Fields.1 Value="1766678893" />' +
      '<Fields.2 Value="1634956137" /><Fields.3 Value="1986330624" /></Uid></Vst3PluginInfo>' +
      '</PluginDesc></PluginDevice>' +
      '<PluginDevice Id="3"><PluginDesc><VstPluginInfo Id="0"><PlugName Value="Serum" />' +
      '<UniqueId Value="1483109208" /></VstPluginInfo></PluginDesc></PluginDevice>' +
      '<AuPluginDevice Id="4"><PluginDesc><AuPluginInfo Id="0"><ComponentType Value="1635085685" />' +
      '<ComponentSubType Value="1483109208" /><ComponentManufacturer Value="1481000274" />' +
      '<Name Value="Serum" /></AuPluginInfo></PluginDesc></AuPluginDevice>'
    const info = await analyze(liveSet('', { plugins }))
    const serum: PluginRef = { format: 'VST2', ident: '1483109208', name: 'Serum' }
    expect(instances(info, serum)).toBe(2)
    expect(pluginCode(serum)).toBe('XfsX')
    expect(
      instances(info, {
        format: 'VST3',
        ident: '5653544e694d616d6173736976650000',
        name: 'Massive',
      }),
    ).toBe(1)
    expect(instances(info, { format: 'AU', ident: 'aumu:XfsX:XFER', name: 'Serum' })).toBe(1)
    expect([fourcc(1483109208), fourcc(0x01020304)]).toEqual(['XfsX', ''])
  })

  test('the content hash compares music, not paths', async () => {
    const a = await analyze(
      liveSet(midiTrack({ arrangement: [midiClip(0, 4, { notes: [[60, 0, 1]] })] })),
    )
    const b = await analyze(
      liveSet(
        midiTrack({
          arrangement: [midiClip(0, 4, { notes: [[60, 0, 1]], clipId: 7 })],
          userName: 'Lead',
        }),
      ),
    )
    const c = await analyze(
      liveSet(midiTrack({ arrangement: [midiClip(0, 4, { notes: [[62, 0, 1]] })] })),
    )
    expect(a.contentHash).toBe(b.contentHash)
    expect(a.contentHash).not.toBe(c.contentHash)
  })

  const fixtures = fixturesDir()
  test('real sets', async () => {
    const projects = join(fixtures, 'projects')
    const open = async (...parts: string[]) =>
      analyzeSet(
        await openDocument(new Uint8Array(readFileSync(join(projects, ...parts))), testCodec),
      )
    const info = await open('VST2toVST3 Project', 'VST2toVST3.als')
    expect([info.major, info.tracks.MidiTrack]).toEqual([12, 6])
    const pairs = new Set(info.plugins.map((p) => `${p.ref.format}/${p.ref.name}`))
    expect(pairs).toEqual(
      new Set(
        ['VST2', 'VST3'].flatMap((f) => ['Massive', 'Serum', 'Omnisphere'].map((n) => `${f}/${n}`)),
      ),
    )
    // Live's own "Collect All and Save" only changed sample paths: the music is the same
    const broken = await open('Brokenpath Project', 'Brokenpath.als')
    const fixed = await open('Fixed Path Project', 'Fixed Path.als')
    expect(broken.contentHash).toBe(fixed.contentHash)
  })
})
