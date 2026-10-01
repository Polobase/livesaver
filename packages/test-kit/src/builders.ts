/**
 * Live Set builders (the structure of sets saved by Live 9–12, reduced to what a test needs), and a
 * stand-in for `osascript` driving Finder.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc16umts } from '@livesaver/core'

const VERSIONS: Record<number, [string, string]> = {
  9: ['9.0_305', 'Ableton Live 9.1.1'],
  10: ['10.0_377', 'Ableton Live 10.1.30'],
  11: ['11.0_11300', 'Ableton Live 11.3.13'],
  12: ['12.0_12402', 'Ableton Live 12.4.2'],
}

const MASTER_ENVELOPES = `<AutomationEnvelopes><Envelopes>
    <AutomationEnvelope Id="0"><EnvelopeTarget><PointeeId Value="8" /></EnvelopeTarget>
        <Automation><Events><FloatEvent Id="1" Time="-63072000" Value="120" /></Events></Automation>
    </AutomationEnvelope></Envelopes></AutomationEnvelopes>`

export interface LiveSetOptions {
  readonly major?: number
  readonly tempo?: number
  readonly signature?: number
  readonly scenes?: number
  readonly locators?: string
  readonly masterDevices?: string
  readonly plugins?: string
}

/** A minimal Live Set: tracks, master with tempo and time signature, scenes, locators, plug-ins. */
export function liveSet(tracks = '', o: LiveSetOptions = {}): string {
  const major = o.major ?? 12
  const [minor, creator] = VERSIONS[major] as [string, string]
  const master = major >= 12 ? 'MainTrack' : 'MasterTrack'
  const envelopes = major >= 10 ? MASTER_ENVELOPES : ''
  const scenes = o.scenes ?? 8
  const sceneList =
    major >= 11
      ? `<Scenes>${'<Scene Id="0"><Name Value="" /></Scene>'.repeat(scenes)}</Scenes>`
      : `<SceneNames>${'<Scene Value="" />'.repeat(scenes)}</SceneNames>`
  return `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="${minor}" Creator="${creator}">
<LiveSet>
<Tracks>${tracks}</Tracks>
<${master}>${envelopes}<DeviceChain><Mixer><Tempo><Manual Value="${o.tempo ?? 120}" /></Tempo>
    <TimeSignature><Manual Value="${o.signature ?? 201}" /></TimeSignature></Mixer>
    <DeviceChain><Devices>${o.masterDevices ?? ''}</Devices></DeviceChain></DeviceChain></${master}>
${sceneList}
<Locators><Locators>${o.locators ?? ''}</Locators></Locators>
<PluginHolder>${o.plugins ?? ''}</PluginHolder>
</LiveSet></Ableton>
`
}

export function midiClip(
  start: number,
  end: number,
  o: {
    notes?: readonly (readonly [number, number, number])[]
    disabled?: boolean
    clipId?: number
  } = {},
): string {
  const keys = new Map<number, string[]>()
  for (const [key, time, duration] of o.notes ?? [[60, 0, 1]]) {
    const list = keys.get(key) ?? []
    list.push(`<MidiNoteEvent Time="${time}" Duration="${duration}" Velocity="100" />`)
    keys.set(key, list)
  }
  const keyTracks = [...keys]
    .map(
      ([k, n], i) =>
        `<KeyTrack Id="${i}"><Notes>${n.join('')}</Notes><MidiKey Value="${k}" /></KeyTrack>`,
    )
    .join('')
  return (
    `<MidiClip Id="${o.clipId ?? 0}" Time="${start}"><CurrentStart Value="${start}" /><CurrentEnd Value="${end}" />` +
    '<Loop><LoopStart Value="0" /><LoopEnd Value="4" /><StartRelative Value="0" /></Loop>' +
    `<Name Value="" /><Disabled Value="${o.disabled ? 'true' : 'false'}" />` +
    `<Notes><KeyTracks>${keyTracks}</KeyTracks></Notes></MidiClip>`
  )
}

export function audioClip(start: number, end: number, sample = 'Kick.wav'): string {
  return (
    `<AudioClip Id="0" Time="${start}"><CurrentStart Value="${start}" /><CurrentEnd Value="${end}" />` +
    '<Name Value="" /><Disabled Value="false" /><SampleRef><FileRef>' +
    `<RelativePath Value="Samples/${sample}" /><Path Value="/x/Samples/${sample}" /></FileRef></SampleRef>` +
    '</AudioClip>'
  )
}

export function automation(count: number, real = true): string {
  const time = real ? 16 : -63072000
  return Array.from(
    { length: count },
    (_, i) =>
      `<AutomationEnvelope Id="${i}"><EnvelopeTarget><PointeeId Value="${100 + i}" /></EnvelopeTarget>` +
      '<Automation><Events><FloatEvent Id="1" Time="-63072000" Value="0" />' +
      `<FloatEvent Id="2" Time="${time}" Value="1" /></Events></Automation></AutomationEnvelope>`,
  ).join('')
}

export interface MidiTrackOptions {
  readonly arrangement?: readonly string[]
  readonly session?: readonly string[]
  readonly userName?: string
  readonly envelopes?: string
  readonly freeze?: readonly string[]
  readonly takes?: readonly string[]
  readonly extra?: string
}

export function midiTrack(o: MidiTrackOptions = {}): string {
  const slots = (o.session ?? [])
    .map((clip, i) =>
      clip
        ? `<ClipSlot Id="${i}"><ClipSlot><Value>${clip}</Value></ClipSlot></ClipSlot>`
        : `<ClipSlot Id="${i}"><ClipSlot><Value /></ClipSlot></ClipSlot>`,
    )
    .join('')
  return `<MidiTrack Id="1"><Name><EffectiveName Value="1-MIDI" /><UserName Value="${o.userName ?? ''}" /></Name>
<AutomationEnvelopes><Envelopes>${o.envelopes ?? ''}</Envelopes></AutomationEnvelopes>
<TakeLanes><TakeLanes><TakeLane Id="0"><ClipAutomation><Events>${(o.takes ?? []).join('')}</Events></ClipAutomation></TakeLane>
</TakeLanes></TakeLanes>
<DeviceChain>${o.extra ?? ''}<MainSequencer><ClipSlotList>${slots}</ClipSlotList>
<ClipTimeable><ArrangerAutomation><Events>${(o.arrangement ?? []).join('')}</Events></ArrangerAutomation></ClipTimeable>
</MainSequencer>
<FreezeSequencer><Sample><ArrangerAutomation><Events>${(o.freeze ?? []).join('')}</Events></ArrangerAutomation></Sample>
</FreezeSequencer></DeviceChain></MidiTrack>`
}

/** An audio track with arrangement clips. */
export function audioTrack(arrangement: readonly string[] = []): string {
  return `<AudioTrack Id="2"><Name><EffectiveName Value="2-Audio" /><UserName Value="" /></Name>
<DeviceChain><MainSequencer><ClipSlotList />
<Sample><ArrangerAutomation><Events>${arrangement.join('')}</Events></ArrangerAutomation></Sample>
</MainSequencer></DeviceChain></AudioTrack>`
}

// ------------------------------------------------------------------------------------ test_status

export const SERUM =
  '<PluginDevice Id="1"><PluginDesc><VstPluginInfo Id="0"><PlugName Value="Serum" />' +
  '<UniqueId Value="1483109208" /></VstPluginInfo></PluginDesc></PluginDevice>'
export const KICKSTART =
  '<PluginDevice Id="2"><PluginDesc><VstPluginInfo Id="0"><PlugName Value="Kickstart-64bit" />' +
  '<UniqueId Value="1265200243" /></VstPluginInfo></PluginDesc></PluginDevice>'

/** An audio clip whose sample has an absolute path and no fingerprint. */
export function sampleClip(path: string): string {
  return (
    '<AudioClip Id="0" Time="0"><CurrentStart Value="0" /><CurrentEnd Value="4" /><Name Value="" />' +
    '<Disabled Value="false" /><SampleRef><FileRef><RelativePathType Value="0" />' +
    `<RelativePath Value="" /><Path Value="${path}" /><OriginalFileSize Value="0" /></FileRef>` +
    '</SampleRef></AudioClip>'
  )
}

/** An audio track holding the given clips in the arrangement (no name). */
export function clipsTrack(clips: readonly string[]): string {
  return (
    '<AudioTrack Id="2"><Name><UserName Value="" /></Name><DeviceChain><MainSequencer><ClipSlotList />' +
    `<Sample><ArrangerAutomation><Events>${clips.join('')}</Events></ArrangerAutomation></Sample>` +
    '</MainSequencer></DeviceChain></AudioTrack>'
  )
}

/** A different combination of tracks every 8 bars: `blocks` distinct blocks. */
export function arranged(blocks: number, barsEach = 8, envelopes = 0): string {
  const tracks: string[] = []
  for (let i = 0; i < blocks; i++) {
    const start = i * barsEach * 4
    tracks.push(
      midiTrack({
        arrangement: [midiClip(start, start + barsEach * 4)],
        envelopes: i === 0 ? automation(envelopes) : '',
      }),
    )
  }
  return tracks.join('')
}

// ------------------------------------------------------------------------------------ test_move

export const MOVE_HEAD =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<Ableton MajorVersion="5" MinorVersion="11.0_11300" Creator="Ableton Live 11.3.13">\n\t<LiveSet>\n'
export const MOVE_TAIL = '\t</LiveSet>\n</Ableton>\n'
const SAMPLE_REF = `\t\t<SampleRef>
\t\t\t<FileRef>
\t\t\t\t<RelativePathType Value="3" />
\t\t\t\t<RelativePath Value="Samples/Imported/NAME" />
\t\t\t\t<Path Value="PATH" />
\t\t\t\t<Type Value="2" />
\t\t\t\t<LivePackName Value="" />
\t\t\t\t<LivePackId Value="" />
\t\t\t\t<OriginalFileSize Value="SIZE" />
\t\t\t\t<OriginalCrc Value="CRC" />
\t\t\t\t<SourceHint Value="" />
\t\t\t</FileRef>
\t\t\t<LastModDate Value="1719000000" />
\t\t</SampleRef>
`

const xmlAttr = (v: string) =>
  v
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

/** Live 11 set whose sample references point into Samples/Imported of the project. */
export function sampleSet(root: string, names: readonly string[]): string {
  const refs = names.map((name) => {
    const path = join(root, 'Samples', 'Imported', name)
    const data = readFileSync(path)
    const crc = crc16umts(
      new Uint8Array(data.buffer, data.byteOffset, Math.min(data.byteLength, 16384)),
    )
    return SAMPLE_REF.replace('NAME', xmlAttr(name))
      .replace('PATH', xmlAttr(path))
      .replace('SIZE', String(data.byteLength))
      .replace('CRC', String(crc))
  })
  return MOVE_HEAD + refs.join('') + MOVE_TAIL
}

/** A set referencing a file outside its own project. */
export function foreignRef(path: string, relType = 0, rel = ''): string {
  return `${MOVE_HEAD}<SampleRef><FileRef><RelativePathType Value="${relType}" /><RelativePath Value="${rel}" />
<Path Value="${path}" /><Type Value="2" /><LivePackName Value="" /><LivePackId Value="" />
<OriginalFileSize Value="0" /><OriginalCrc Value="0" /></FileRef><LastModDate Value="0" /></SampleRef>${MOVE_TAIL}`
}

// ------------------------------------------------------------------------------------ Finder

export interface FakeOsascript {
  /** Comments per path, as Finder would keep them. */
  readonly comments: Map<string, string>
  /** Arguments of every call. */
  readonly calls: string[][]
  readonly runner: (
    script: string,
    args: readonly string[],
  ) => Promise<{ code: number; stdout: string; stderr: string }>
}

/** Stands in for `osascript` driving Finder: keeps comments per path, as Finder would. */
export function fakeOsascript(comments: Record<string, string> = {}, error = ''): FakeOsascript {
  const state = new Map(Object.entries(comments))
  const calls: string[][] = []
  return {
    comments: state,
    calls,
    async runner(script, args) {
      calls.push([...args])
      if (error) return { code: 1, stdout: '', stderr: error }
      if (script.includes('set comment of')) {
        for (let i = 0; i + 1 < args.length; i += 2)
          state.set(args[i] as string, args[i + 1] as string)
        return { code: 0, stdout: '', stderr: '' }
      }
      return {
        code: 0,
        stdout: `${args.map((p) => state.get(p) ?? '').join('\x1e')}\n`,
        stderr: '',
      }
    },
  }
}
