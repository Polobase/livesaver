/**
 * Codemods: small programs that change Live Sets through typed views and the byte-exact patcher.
 * A codemod never writes bytes itself; it describes edits (`set.patch`), and livesaver checks the
 * result (well-formed, the sets' references and plug-ins accounted for), writes a backup, journals
 * the change and replaces the set atomically, so `livesaver undo` reverses it like any other run.
 *
 *   export default defineCodemod({
 *     name: 'set-tempo',
 *     transform(set, ctx) { set.setTempo(Number(ctx.options.bpm)) },
 *   })
 *
 * Codemod files use only TypeScript that type stripping removes (Node ≥ 22.18 runs them directly).
 */
import {
  DEFAULT_TIME,
  documentFromXml,
  encodeDocument,
  type FileStat,
  fileRefs,
  type Host,
  idCode,
  openDocument,
  type PluginRef,
  posix,
  pyFloat,
} from '@livesaver/core'
import { type El, Patch, type XmlIndex } from '@livesaver/xml'
import { DRY_RUN, findSets, projectRootOf, type Writer } from './collect.js'
import { Probe } from './probe.js'

export interface CodemodContext {
  readonly path: string
  readonly projectRoot: string
  /** `--option key=value` from the command line. */
  readonly options: Readonly<Record<string, string>>
  /** A note about this set for the report (e.g. why something was left alone). */
  note(message: string): void
}

export interface Codemod {
  readonly name: string
  readonly description?: string
  /** Options the codemod understands (shown in help), name → description. */
  readonly options?: Readonly<Record<string, string>>
  /** File extensions to visit (default: `.als`). */
  readonly extensions?: readonly string[]
  /** A quick test on the decompressed XML, before the element index is built. */
  readonly match?: (xml: Uint8Array) => boolean
  /** Describe the changes through `set` (views and patch primitives). */
  transform(set: SetView, ctx: CodemodContext): void | Promise<void>
}

/** Identity function that gives a codemod object its type (optional in plain JavaScript). */
export function defineCodemod<T extends Codemod>(codemod: T): T {
  return codemod
}

const TRACK_KINDS = {
  AudioTrack: 'audio',
  MidiTrack: 'midi',
  GroupTrack: 'group',
  ReturnTrack: 'return',
  MainTrack: 'main',
  MasterTrack: 'main',
} as const
export type TrackKind = (typeof TRACK_KINDS)[keyof typeof TRACK_KINDS]

/** Live's text for a number: integers without decimals ("120"), others as shortest decimal. */
export function liveNumber(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`not a number: ${n}`)
  return String(n)
}

/** A whole Live Set: tracks, master, locators, plus the raw index and patch for anything else. */
export class SetView {
  readonly index: XmlIndex
  readonly patch: Patch
  readonly liveSet: El

  constructor(index: XmlIndex, patch: Patch) {
    this.index = index
    this.patch = patch
    const liveSet = index.child(index.root, 'LiveSet')
    if (liveSet === undefined) throw new Error('no LiveSet in the document')
    this.liveSet = liveSet
  }

  /** Root attribute, e.g. `Creator` or `MinorVersion`. */
  rootAttr(name: string): string {
    return this.index.attr(this.index.root, name) ?? ''
  }

  /** Every track in the Tracks list (audio, MIDI, group and return tracks), in order. */
  tracks(): TrackView[] {
    const list = this.index.child(this.liveSet, 'Tracks')
    if (list === undefined) return []
    return this.index
      .children(list)
      .filter((el) => this.index.name(el) in TRACK_KINDS)
      .map((el) => new TrackView(this, el))
  }

  /** The master (`MainTrack` in Live 12, `MasterTrack` before). */
  master(): TrackView | undefined {
    const el =
      this.index.child(this.liveSet, 'MainTrack') ?? this.index.child(this.liveSet, 'MasterTrack')
    return el === undefined ? undefined : new TrackView(this, el)
  }

  /** The master tempo (the value Live starts with when it is not automated). */
  get tempo(): number {
    const manual = this.tempoParts()?.manual
    return manual === undefined ? 120 : pyFloat(this.index.attr(manual, 'Value') ?? '120')
  }

  /** Whether the tempo has automation beyond its start value. */
  get tempoAutomated(): boolean {
    return (this.tempoParts()?.events ?? []).some((e) => this.eventTime(e) > DEFAULT_TIME + 1)
  }

  /** Set the master tempo; returns false (and changes nothing) when the tempo is automated. */
  setTempo(bpm: number): boolean {
    const parts = this.tempoParts()
    if (!parts?.manual || !(bpm >= 10 && bpm <= 999))
      throw new Error(`tempo ${bpm} out of range (10–999)`)
    if (this.tempoAutomated) return false
    this.patch.setAttr(parts.manual, 'Value', liveNumber(bpm))
    // Live 10+ keeps an envelope whose event at the default time holds the value.
    for (const e of parts.events) this.patch.setAttr(e, 'Value', liveNumber(bpm))
    return true
  }

  /** Locators in time order. */
  locators(): { el: El; time: number; name: string }[] {
    const list = this.index.find(this.liveSet, 'Locators/Locators')
    if (list === undefined) return []
    return this.index
      .children(list)
      .map((el) => ({
        el,
        time: pyFloat(this.index.value(el, 'Time') ?? '0'),
        name: this.index.value(el, 'Name') ?? '',
      }))
      .sort((a, b) => a.time - b.time)
  }

  /** Set the `Value` attribute of the element at `path` below `el` (e.g. 'Name/UserName'). */
  setValue(el: El, path: string, value: string): void {
    const target = this.index.find(el, path)
    if (target === undefined) throw new Error(`no ${path} in ${this.index.name(el)}`)
    this.patch.setAttr(target, 'Value', value)
  }

  private linked: Set<string> | undefined

  /** Ids of automation/modulation targets that some envelope or mapping points to. */
  pointees(): ReadonlySet<string> {
    if (!this.linked) {
      this.linked = new Set()
      for (const el of this.index.all('PointeeId')) {
        const v = this.index.attr(el, 'Value')
        if (v) this.linked.add(v)
      }
    }
    return this.linked
  }

  private eventTime(e: El): number {
    try {
      return pyFloat(this.index.attr(e, 'Time') ?? String(DEFAULT_TIME))
    } catch {
      return DEFAULT_TIME
    }
  }

  private tempoParts(): { manual: El | undefined; events: El[] } | undefined {
    const master = this.master()
    if (!master) return undefined
    const ix = this.index
    const tempo = ix.find(master.el, 'DeviceChain/Mixer/Tempo')
    if (tempo === undefined) return undefined
    const manual = ix.child(tempo, 'Manual')
    const target = ix.attr(ix.child(tempo, 'AutomationTarget') ?? tempo, 'Id')
    const events: El[] = []
    // Live 9: the events sit in the parameter itself.
    const own = ix.find(tempo, 'ArrangerAutomation/Events')
    if (own !== undefined) events.push(...ix.children(own))
    // Live 10+: an envelope of the master points at the tempo's automation target.
    const envelopes = ix.find(master.el, 'AutomationEnvelopes/Envelopes')
    for (const env of envelopes === undefined ? [] : ix.children(envelopes)) {
      if (target && ix.value(env, 'EnvelopeTarget/PointeeId') === target) {
        const list = ix.find(env, 'Automation/Events')
        if (list !== undefined) events.push(...ix.children(list))
      }
    }
    return { manual, events }
  }
}

export class TrackView {
  readonly set: SetView
  readonly el: El

  constructor(set: SetView, el: El) {
    this.set = set
    this.el = el
  }

  get kind(): TrackKind {
    return TRACK_KINDS[this.set.index.name(this.el) as keyof typeof TRACK_KINDS]
  }

  /** The name shown in Live (the user's name, else Live's automatic one). */
  get name(): string {
    const ix = this.set.index
    return ix.value(this.el, 'Name/UserName') || ix.value(this.el, 'Name/EffectiveName') || ''
  }

  rename(name: string): void {
    this.set.setValue(this.el, 'Name/UserName', name)
  }

  /** The devices of the track's chain, in order (racks as one device). */
  devices(): DeviceView[] {
    const ix = this.set.index
    const list = ix.find(this.el, 'DeviceChain/DeviceChain/Devices')
    return list === undefined ? [] : ix.children(list).map((el) => new DeviceView(this.set, el))
  }
}

/** Names Live shows for its devices whose element names differ. */
export const DEVICE_NAMES: Readonly<Record<string, string>> = {
  OriginalSimpler: 'Simpler',
  MultiSampler: 'Sampler',
  InstrumentVector: 'Wavetable',
  UltraAnalog: 'Analog',
  LoungeLizard: 'Electric',
  StringStudio: 'Tension',
  InstrumentMeld: 'Meld',
  InstrumentImpulse: 'Impulse',
  InstrumentGroupDevice: 'Instrument Rack',
  DrumGroupDevice: 'Drum Rack',
  AudioEffectGroupDevice: 'Audio Effect Rack',
  MidiEffectGroupDevice: 'MIDI Effect Rack',
  Eq8: 'EQ Eight',
  FilterEQ3: 'EQ Three',
  Compressor2: 'Compressor',
  GlueCompressor: 'Glue Compressor',
  MultibandDynamics: 'Multiband Dynamics',
  AutoFilter: 'Auto Filter',
  AutoPan: 'Auto Pan',
  StereoGain: 'Utility',
  Tuner: 'Tuner',
  PingPongDelay: 'Ping Pong Delay',
  FilterDelay: 'Filter Delay',
  CrossDelay: 'Simple Delay',
  Delay: 'Delay',
  Reverb: 'Reverb',
  Hybrid: 'Hybrid Reverb',
  Saturator: 'Saturator',
  DrumBuss: 'Drum Buss',
  ChannelEq: 'Channel EQ',
  MidiArpeggiator: 'Arpeggiator',
  MidiChord: 'Chord',
  MidiScale: 'Scale',
  MidiNoteLength: 'Note Length',
  MidiPitcher: 'Pitch',
  MidiRandom: 'Random',
  MidiVelocity: 'Velocity',
  MxDeviceAudioEffect: 'Max Audio Effect',
  MxDeviceInstrument: 'Max Instrument',
  MxDeviceMidiEffect: 'Max MIDI Effect',
}

export class DeviceView {
  readonly set: SetView
  readonly el: El

  constructor(set: SetView, el: El) {
    this.set = set
    this.el = el
  }

  /** The element name: `Reverb`, `Limiter`, `PluginDevice`, `InstrumentGroupDevice` … */
  get type(): string {
    return this.set.index.name(this.el)
  }

  /** The device's name in Live: its user name, the plug-in's name, or the device's own name. */
  get name(): string {
    const ix = this.set.index
    return (
      ix.value(this.el, 'UserName') || this.plugin?.name || DEVICE_NAMES[this.type] || this.type
    )
  }

  get isRack(): boolean {
    return /GroupDevice$/.test(this.type)
  }

  /** The plug-in a `PluginDevice`/`AuPluginDevice` hosts. */
  get plugin(): PluginRef | undefined {
    const ix = this.set.index
    const vst = ix.find(this.el, 'PluginDesc/VstPluginInfo')
    if (vst !== undefined)
      return {
        format: 'VST2',
        ident: String(Number(ix.value(vst, 'UniqueId') ?? 0) >>> 0),
        name: ix.value(vst, 'PlugName') ?? '',
      }
    const vst3 = ix.find(this.el, 'PluginDesc/Vst3PluginInfo')
    if (vst3 !== undefined) {
      const uid = ix.child(vst3, 'Uid')
      const fields = [0, 1, 2, 3].map(
        (i) => Number(uid === undefined ? 0 : (ix.value(uid, `Fields.${i}`) ?? 0)) >>> 0,
      )
      return {
        format: 'VST3',
        ident: fields.map((f) => f.toString(16).padStart(8, '0')).join(''),
        name: ix.value(vst3, 'Name') ?? '',
      }
    }
    const au = ix.find(this.el, 'PluginDesc/AuPluginInfo')
    if (au !== undefined) {
      const code = (tag: string) => idCode(Number(ix.value(au, tag) ?? 0))
      return {
        format: 'AU',
        ident: `${code('ComponentType')}:${code('ComponentSubType')}:${code('ComponentManufacturer')}`,
        name: ix.value(au, 'Name') ?? '',
      }
    }
    return undefined
  }

  private onParts(): { manual: El | undefined; target: string } {
    const ix = this.set.index
    const on = ix.child(this.el, 'On')
    if (on === undefined) return { manual: undefined, target: '' }
    return {
      manual: ix.child(on, 'Manual'),
      target: ix.attr(ix.child(on, 'AutomationTarget') ?? on, 'Id') ?? '',
    }
  }

  /** Whether the device is switched on. */
  get on(): boolean {
    const { manual } = this.onParts()
    return manual === undefined || this.set.index.attr(manual, 'Value') !== 'false'
  }

  /** Whether the on/off switch is automated or mapped (then `setOn` changes nothing). */
  get onLinked(): boolean {
    const { target } = this.onParts()
    return Boolean(target) && this.set.pointees().has(target)
  }

  /** Switch the device on or off; false when the switch is automated or mapped. */
  setOn(on: boolean): boolean {
    const { manual } = this.onParts()
    if (manual === undefined || this.onLinked) return false
    if (this.on !== on) this.set.patch.setAttr(manual, 'Value', on ? 'true' : 'false')
    return true
  }

  /** Every device list inside a rack (its chains, and those of nested racks), in document order. */
  chains(): DeviceView[][] {
    const ix = this.set.index
    return ix
      .descendants(this.el, 'Devices')
      .map((d) => ix.children(d).map((el) => new DeviceView(this.set, el)))
  }
}

export interface CodemodResult {
  readonly setPath: string
  readonly projectRoot: string
  changed: boolean
  edits: number
  notes: string[]
  written: boolean
  backup: string
  error: string
}

export interface CodemodRunOptions {
  readonly targets: readonly string[]
  readonly excludes?: readonly string[]
  readonly options?: Readonly<Record<string, string>>
  readonly writer?: Writer
  readonly probe?: Probe
  readonly onSet?: (result: CodemodResult, index: number, total: number) => void
}

function sameFile(a: FileStat, b: FileStat): boolean {
  return a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.ino === b.ino
}

function count(index: XmlIndex, name: string): number {
  return index.all(name).length
}

/** Run a codemod over the sets below `targets` (a dry run unless the writer applies). */
export async function runCodemod(
  host: Host,
  codemod: Codemod,
  options: CodemodRunOptions,
): Promise<{ results: CodemodResult[]; base: string; ms: number }> {
  const started = performance.now()
  const probe = options.probe ?? new Probe(host.fs, host.hash)
  const writer = options.writer ?? DRY_RUN
  const extensions = (codemod.extensions ?? ['.als']).map((e) =>
    (e.startsWith('.') ? e : `.${e}`).toLowerCase(),
  )
  let base = posix.commonpath(options.targets)
  if (await probe.isFile(base)) base = posix.dirname(base)
  const files = (await findSets(options.targets, options.excludes ?? [], probe)).filter((f) =>
    extensions.includes(posix.splitext(f)[1].toLowerCase()),
  )
  const results: CodemodResult[] = []
  for (const [i, path] of files.entries()) {
    const root = await projectRootOf(path, probe)
    const result: CodemodResult = {
      setPath: path,
      projectRoot: root,
      changed: false,
      edits: 0,
      notes: [],
      written: false,
      backup: '',
      error: '',
    }
    results.push(result)
    try {
      const stat = await host.fs.stat(path)
      const opened = await openDocument(
        await host.fs.readFile(path),
        host.codec,
        host.search ? { search: host.search } : {},
      )
      if (codemod.match && !codemod.match(opened.xml)) {
        options.onSet?.(result, i + 1, files.length)
        continue
      }
      const doc = documentFromXml(opened.xml, opened.gzipped, true, host.search)
      const patch = new Patch(doc.index)
      await codemod.transform(new SetView(doc.index, patch), {
        path,
        projectRoot: root,
        options: options.options ?? {},
        note: (m) => result.notes.push(m),
      })
      const edits = patch.edits()
      if (edits.length) {
        // The result must be well-formed; removed references or plug-ins are reported.
        const { bytes, index } = patch.applyChecked()
        const plugins = (ix: XmlIndex) => count(ix, 'PluginDevice') + count(ix, 'AuPluginDevice')
        const before = { refs: fileRefs(doc).length, plugins: plugins(doc.index) }
        const after = documentFromXml(bytes, opened.gzipped, false, host.search)
        const now = { refs: fileRefs(after).length, plugins: plugins(index) }
        if (now.refs !== before.refs) result.notes.push(`references ${before.refs} → ${now.refs}`)
        if (now.plugins !== before.plugins)
          result.notes.push(`plug-ins ${before.plugins} → ${now.plugins}`)
        result.changed = true
        result.edits = edits.length
        if (writer.apply) {
          const data = await encodeDocument(opened, bytes, host.codec)
          const current = await host.fs.stat(path)
          if (stat && (!current || !sameFile(current, stat)))
            throw new Error('the set changed after it was read (is Live saving it?); not written')
          result.backup = await writer.writeSet(path, root, data)
          result.written = true
        }
      }
    } catch (error) {
      result.error = (error as Error).message
    }
    options.onSet?.(result, i + 1, files.length)
  }
  return { results, base, ms: performance.now() - started }
}
