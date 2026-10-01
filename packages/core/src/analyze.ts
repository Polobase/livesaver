/**
 * How far a Live Set got: arrangement, session, automation, tracks and plug-ins (read-only).
 * Measured on the element index. Numbers in the content hash are formatted like Python's
 * `f"{x:.6f}"`, so the hash is stable across tools and versions and finds copies of the same music.
 *
 * Element paths below `Ableton/LiveSet`:
 * - arrangement clips: `<Track>/DeviceChain/MainSequencer/ClipTimeable/ArrangerAutomation/Events/MidiClip`
 *   and `…/MainSequencer/Sample/ArrangerAutomation/Events/AudioClip`
 * - session clips: `…/MainSequencer/ClipSlotList/ClipSlot/ClipSlot/Value/(MidiClip|AudioClip)`
 * - master: `MasterTrack` (≤ 11) or `MainTrack` (12); tempo and time signature in
 *   `DeviceChain/Mixer/(Tempo|TimeSignature)/Manual`; signature v means (v % 99 + 1) / 2^(v // 99)
 * - automation: Live 10+ `<Track>/AutomationEnvelopes/Envelopes`, Live 9 an `ArrangerAutomation` per
 *   parameter; an event at the default time -63072000 holds the value, only later events automate
 */
import { decodeEntities, decodeUtf8, type El, type XmlIndex } from '@livesaver/xml'
import { compareCodePoints, pyFixed, pyFloat, pyFloorDiv, pyMod, pyStrip } from './compat.js'
import type { LiveDoc } from './document.js'
import { Sha1 } from './sha1.js'

export const DEFAULT_TIME = -63072000.0
export const BLOCK_BARS = 8
const MAX_BLOCKS = 20000
const TRACK_TYPES = new Set(['AudioTrack', 'MidiTrack', 'GroupTrack', 'ReturnTrack'])
const CLIP_TAGS = new Set(['MidiClip', 'AudioClip'])
export const MASTERING_DEVICES: ReadonlySet<string> = new Set([
  'Limiter',
  'GlueCompressor',
  'Compressor2',
  'MultibandDynamics',
])
const NOT_PARAMETERS = new Set(['MainSequencer', 'FreezeSequencer', 'ClipSlotList', 'TakeLanes'])

export type PluginFormat = 'VST2' | 'VST3' | 'AU'

/** A plug-in as the Set refers to it; Live finds it by format and id, never by name. */
export interface PluginRef {
  readonly format: PluginFormat
  /** VST2: unique id (decimal), VST3: class id (32 hex digits), AU: "type:subtype:manufacturer". */
  readonly ident: string
  readonly name: string
}

export interface SetInfo {
  readonly creator: string
  /** Live version of the file format (9, 10, 11, 12). */
  readonly major: number
  /** "12.4" from the creator, else the major version. */
  readonly version: string
  readonly tempo: number
  readonly signature: readonly [number, number]
  /** Track counts by element name (AudioTrack, MidiTrack, GroupTrack, ReturnTrack). */
  readonly tracks: Readonly<Record<string, number>>
  readonly namedTracks: number
  readonly arrangementClips: number
  readonly arrangementTracks: number
  /** First arrangement clip, in beats. */
  readonly start: number
  /** End of the last arrangement clip, in beats. */
  readonly end: number
  /** 8-bar blocks from the first clip to the end. */
  readonly blocks: number
  /** Different combinations of playing tracks among those blocks. */
  readonly distinctBlocks: number
  readonly sessionClips: number
  readonly scenes: number
  readonly scenesUsed: number
  /** Locator names in time order. */
  readonly locators: readonly string[]
  /** Automated parameters in the arrangement. */
  readonly automated: number
  /** Mastering devices on the master, racks included. */
  readonly masterDevices: readonly string[]
  /** Plug-ins with their instance counts, in order of appearance. */
  readonly plugins: readonly { readonly ref: PluginRef; readonly instances: number }[]
  /** Tempo, clips and notes; equal for copies of the same music. */
  readonly contentHash: string
  readonly beatsPerBar: number
  readonly hasArrangement: boolean
  readonly empty: boolean
  readonly lengthBeats: number
  readonly bars: number
  readonly seconds: number
  readonly startBar: number
  readonly contentTracks: number
}

/** Four-character code of a 32-bit id ('' if not printable). */
export function fourcc(value: number): string {
  const n = value >>> 0
  const bytes = [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
  return bytes.every((b) => b >= 32 && b < 127) ? String.fromCharCode(...bytes) : ''
}

/** Four-character code of a plug-in id, or 8 hex digits if it is not printable. */
export function idCode(value: number): string {
  return fourcc(value) || (value >>> 0).toString(16).padStart(8, '0')
}

/** Readable id: the four characters of a VST2 id, the AU codes or the VST3 class id. */
export function pluginCode(ref: PluginRef): string {
  return ref.format === 'VST2' ? idCode(Number(ref.ident)) : ref.ident
}

function strictInt(text: string): number | undefined {
  const t = pyStrip(text)
  return /^[+-]?\d+(?:_\d+)*$/.test(t) ? Number(t.replaceAll('_', '')) : undefined
}

/** Attribute value as ElementTree reports it (XML attribute-value normalization, then entities). */
function etAttr(ix: XmlIndex, el: El, name: string): string | undefined {
  const span = ix.attrSpan(el, name)
  if (!span) return undefined
  const raw = decodeUtf8(ix.bytes, span.start, span.end)
    .replaceAll('\r\n', '\n')
    .replace(/[\t\n\r]/g, ' ')
  return raw.includes('&') ? decodeEntities(raw) : raw
}

export function analyzeSet(doc: LiveDoc): SetInfo {
  const ix = doc.index
  const root = ix.root
  const liveSet = ix.child(root, 'LiveSet')
  if (liveSet === undefined) throw new Error('no LiveSet in the document')

  const find = (el: El | undefined, path: string) =>
    el === undefined ? undefined : ix.find(el, path)
  const value = (el: El | undefined, fallback = '') =>
    el === undefined ? fallback : (etAttr(ix, el, 'Value') ?? fallback)
  const float = (el: El | undefined, fallback = 0): number => {
    try {
      return pyFloat(value(el, String(fallback)))
    } catch {
      return fallback
    }
  }
  const num = (text: string | undefined): string => {
    if (text === undefined) return ''
    try {
      return pyFixed(pyFloat(text), 6)
    } catch {
      return ''
    }
  }
  const hasAutomation = (events: El | undefined): boolean =>
    events !== undefined &&
    ix
      .children(events)
      .some((e) => pyFloat(etAttr(ix, e, 'Time') ?? String(DEFAULT_TIME)) > DEFAULT_TIME + 1)
  const envelopes = (track: El): number => {
    const list = find(track, 'AutomationEnvelopes/Envelopes')
    if (list === undefined) return 0
    return ix.children(list).filter((env) => hasAutomation(find(env, 'Automation/Events'))).length
  }
  const parameterAutomation = (el: El): number => {
    let count = 0
    for (const c of ix.children(el)) {
      const tag = ix.name(c)
      if (NOT_PARAMETERS.has(tag)) continue
      count +=
        tag === 'ArrangerAutomation'
          ? Number(hasAutomation(find(c, 'Events')))
          : parameterAutomation(c)
    }
    return count
  }
  const sampleName = (fileRef: El | undefined): string => {
    if (fileRef === undefined) return ''
    let name = value(find(fileRef, 'Name'))
    if (!name) {
      const path = value(find(fileRef, 'RelativePath')) || value(find(fileRef, 'Path'))
      name = path ? (path.split(/[\\/]/).at(-1) as string) : ''
    }
    return name
  }
  const clipSignature = (clip: El): string => {
    const tag = ix.name(clip)
    const parts = [
      tag,
      num(value(find(clip, 'CurrentStart'))),
      num(value(find(clip, 'CurrentEnd'))),
      value(find(clip, 'Name')),
    ]
    const loop = find(clip, 'Loop')
    if (loop !== undefined)
      for (const t of ['LoopStart', 'LoopEnd', 'StartRelative'])
        parts.push(num(value(find(loop, t))))
    if (tag === 'MidiClip') {
      const notes: string[] = []
      for (const keyTrack of ix.findAll(clip, 'Notes/KeyTracks/KeyTrack')) {
        const key = value(find(keyTrack, 'MidiKey'))
        for (const note of ix.findAll(keyTrack, 'Notes/MidiNoteEvent')) {
          if ((etAttr(ix, note, 'IsEnabled') ?? 'true') === 'false') continue
          notes.push(
            `${key}@${num(etAttr(ix, note, 'Time'))}/${num(etAttr(ix, note, 'Duration'))}/${num(etAttr(ix, note, 'Velocity'))}`,
          )
        }
      }
      parts.push(notes.sort(compareCodePoints).join(','))
    } else {
      parts.push(sampleName(find(clip, 'SampleRef/FileRef')))
    }
    return parts.join('|')
  }

  const creator = etAttr(ix, root, 'Creator') ?? ''
  const major = Number(/^(\d+)/.exec(etAttr(ix, root, 'MinorVersion') ?? '')?.[1] ?? 0)
  const digest = new Sha1()
  let tempo = 120
  let signature: [number, number] = [4, 4]
  let masterDevices: string[] = []
  let automated = 0

  const master = ix.child(liveSet, 'MainTrack') ?? ix.child(liveSet, 'MasterTrack')
  if (master !== undefined) {
    tempo = float(find(master, 'DeviceChain/Mixer/Tempo/Manual'), 120) || 120
    const sig = Math.trunc(float(find(master, 'DeviceChain/Mixer/TimeSignature/Manual'), 201))
    signature = [pyMod(sig, 99) + 1, 2 ** pyFloorDiv(sig, 99)]
    const devices = find(master, 'DeviceChain/DeviceChain/Devices')
    if (devices !== undefined) {
      masterDevices = [devices, ...ix.descendants(devices)]
        .map((e) => ix.name(e))
        .filter((t) => MASTERING_DEVICES.has(t))
    }
    automated += major >= 10 ? envelopes(master) : parameterAutomation(master)
  }
  digest.update(pyFixed(tempo, 3))

  const tracks: Record<string, number> = {}
  let namedTracks = 0
  let arrangementClips = 0
  let arrangementTracks = 0
  let sessionClips = 0
  const playing: [number, number][][] = []
  const starts: number[] = []
  const ends: number[] = []
  const scenesUsed = new Set<number>()
  const trackList = ix.child(liveSet, 'Tracks')
  for (const track of trackList === undefined ? [] : ix.children(trackList)) {
    const tag = ix.name(track)
    if (!TRACK_TYPES.has(tag)) continue
    tracks[tag] = (tracks[tag] ?? 0) + 1
    const userName = pyStrip(value(find(track, 'Name/UserName')))
    if (userName && !/^\d+-/.test(userName)) namedTracks++
    automated += major >= 10 ? envelopes(track) : parameterAutomation(track)
    digest.update(tag)
    const sequencer = find(track, 'DeviceChain/MainSequencer')
    if (sequencer === undefined) continue
    const intervals: [number, number][] = []
    const signatures: string[] = []
    for (const path of [
      'ClipTimeable/ArrangerAutomation/Events',
      'Sample/ArrangerAutomation/Events',
    ]) {
      const events = find(sequencer, path)
      if (events === undefined) continue
      for (const clip of ix.children(events)) {
        if (!CLIP_TAGS.has(ix.name(clip))) continue
        if (value(find(clip, 'Disabled')) === 'true') continue
        intervals.push([float(find(clip, 'CurrentStart')), float(find(clip, 'CurrentEnd'))])
        signatures.push(clipSignature(clip))
      }
    }
    const slots = find(sequencer, 'ClipSlotList')
    for (const [index, slot] of (slots === undefined ? [] : ix.children(slots)).entries()) {
      const holder = find(slot, 'ClipSlot/Value')
      if (holder === undefined) continue
      for (const clip of ix.children(holder)) {
        if (!CLIP_TAGS.has(ix.name(clip))) continue
        sessionClips++
        scenesUsed.add(index)
        signatures.push(`${index}:${clipSignature(clip)}`)
      }
    }
    for (const s of signatures.sort(compareCodePoints)) digest.update(s)
    if (intervals.length > 0) {
      arrangementClips += intervals.length
      arrangementTracks++
      starts.push(Math.min(...intervals.map(([s]) => s)))
      ends.push(Math.max(...intervals.map(([, e]) => e)))
      playing.push(intervals)
    }
  }
  const contentHash = digest.hex()

  const beatsPerBar = (signature[0] * 4) / signature[1]
  let start = 0
  let end = 0
  let blocks = 0
  let distinctBlocks = 0
  if (playing.length > 0) {
    start = Math.min(...starts)
    end = Math.max(...ends)
    const size = BLOCK_BARS * beatsPerBar
    const first = Math.floor(start / size)
    const last = Math.min(Math.ceil(end / size), first + MAX_BLOCKS)
    const active = new Map<number, Set<number>>()
    for (const [number, intervals] of playing.entries()) {
      for (const [s, e] of intervals) {
        if (e <= s) continue
        for (
          let block = Math.max(first, Math.floor(s / size));
          block < Math.min(last, Math.ceil(e / size));
          block++
        ) {
          const set = active.get(block) ?? new Set<number>()
          set.add(number)
          active.set(block, set)
        }
      }
    }
    blocks = Math.max(0, last - first)
    distinctBlocks = new Set(
      [...active.values()].map((s) => [...s].sort((a, b) => a - b).join(',')),
    ).size
  }

  const scenesEl = ix.child(liveSet, 'Scenes') ?? ix.child(liveSet, 'SceneNames')
  const locatorsEl = ix.find(liveSet, 'Locators/Locators')
  const locators = (locatorsEl === undefined ? [] : ix.children(locatorsEl))
    .map((loc, i) => ({ loc, i, time: float(find(loc, 'Time')) }))
    .sort((a, b) => a.time - b.time || a.i - b.i)
    .map(({ loc }) => value(find(loc, 'Name')))

  const plugins = new Map<string, { ref: PluginRef; instances: number }>()
  const addPlugin = (ref: PluginRef) => {
    const key = `${ref.format}\u0000${ref.ident}\u0000${ref.name}`
    const hit = plugins.get(key)
    if (hit) hit.instances++
    else plugins.set(key, { ref, instances: 1 })
  }
  // All PluginDevices first, then all AuPluginDevices (a stable order for reports).
  for (const device of ix.descendants(liveSet, 'PluginDevice')) {
    const vst = find(device, 'PluginDesc/VstPluginInfo')
    const vst3 = find(device, 'PluginDesc/Vst3PluginInfo')
    if (vst !== undefined) {
      const id = strictInt(value(find(vst, 'UniqueId'), '0'))
      if (id === undefined) continue
      addPlugin({ format: 'VST2', ident: String(id >>> 0), name: value(find(vst, 'PlugName')) })
    } else if (vst3 !== undefined) {
      const uid = find(vst3, 'Uid')
      const fields = new Map<string, string>()
      for (const c of uid === undefined ? [] : ix.children(uid))
        fields.set(ix.name(c), etAttr(ix, c, 'Value') ?? '0')
      const parts: string[] = []
      for (let i = 0; i < 4; i++) {
        const v = fields.get(`Fields.${i}`)
        const n = v === undefined ? undefined : strictInt(v)
        if (n === undefined) break
        parts.push((n >>> 0).toString(16).padStart(8, '0'))
      }
      if (parts.length < 4) continue
      addPlugin({ format: 'VST3', ident: parts.join(''), name: value(find(vst3, 'Name')) })
    }
  }
  for (const device of ix.descendants(liveSet, 'AuPluginDevice')) {
    const au = find(device, 'PluginDesc/AuPluginInfo')
    if (au === undefined) continue
    const codes = ['ComponentType', 'ComponentSubType', 'ComponentManufacturer'].map((t) =>
      strictInt(value(find(au, t), '0')),
    )
    if (codes.some((c) => c === undefined)) continue
    addPlugin({
      format: 'AU',
      ident: codes.map((c) => idCode(c as number)).join(':'),
      name: value(find(au, 'Name')),
    })
  }

  return makeSetInfo({
    creator,
    major,
    tempo,
    signature,
    tracks,
    namedTracks,
    arrangementClips,
    arrangementTracks,
    start,
    end,
    blocks,
    distinctBlocks,
    sessionClips,
    scenes: scenesEl === undefined ? 0 : ix.children(scenesEl).length,
    scenesUsed: scenesUsed.size,
    locators,
    automated,
    masterDevices,
    plugins: [...plugins.values()],
    contentHash,
  })
}

/** The measured fields of a `SetInfo`; the rest is derived from them. */
export type SetMeasures = Omit<
  SetInfo,
  | 'version'
  | 'beatsPerBar'
  | 'hasArrangement'
  | 'empty'
  | 'lengthBeats'
  | 'bars'
  | 'seconds'
  | 'startBar'
  | 'contentTracks'
>

/**
 * A `SetInfo` from measured fields (unmeasured ones default to an empty set: 120 BPM, 4/4), with
 * the derived values (length, bars, stage inputs) computed from them.
 */
export function makeSetInfo(fields: Partial<SetMeasures> = {}): SetInfo {
  const m: SetMeasures = {
    creator: '',
    major: 0,
    tempo: 120,
    signature: [4, 4],
    tracks: {},
    namedTracks: 0,
    arrangementClips: 0,
    arrangementTracks: 0,
    start: 0,
    end: 0,
    blocks: 0,
    distinctBlocks: 0,
    sessionClips: 0,
    scenes: 0,
    scenesUsed: 0,
    locators: [],
    automated: 0,
    masterDevices: [],
    plugins: [],
    contentHash: '',
    ...fields,
  }
  const beatsPerBar = (m.signature[0] * 4) / m.signature[1]
  const hasArrangement = m.arrangementClips > 0
  const lengthBeats = hasArrangement ? Math.max(0, m.end - m.start) : 0
  return {
    ...m,
    version: /Live (\d+\.\d+)/.exec(m.creator)?.[1] ?? (m.major ? String(m.major) : ''),
    beatsPerBar,
    hasArrangement,
    empty: m.arrangementClips === 0 && m.sessionClips === 0,
    lengthBeats,
    bars: lengthBeats / beatsPerBar,
    seconds: m.tempo > 0 ? (lengthBeats * 60) / m.tempo : 0,
    startBar: Math.floor(m.start / beatsPerBar) + 1,
    contentTracks: (m.tracks.AudioTrack ?? 0) + (m.tracks.MidiTrack ?? 0),
  }
}
