/**
 * Switch VST2 plug-in instances in a Live Set to the installed VST3 version, on the decoded XML
 * text. Only the `<VstPluginInfo>` block, the `BranchDeviceId` and, where needed, the parameter
 * list of a converted device change; everything else stays byte-identical. A plug-in is converted
 * in a Set only if all of its instances there can be (Ableton recommends one format per plug-in and
 * Set).
 */
import { documentFromXml, fileRefs } from '@livesaver/core'
import { decodeEntities, encodeUtf8, escapeAttr, scan } from '@livesaver/xml'
import { type Catalog, derivedTarget, Target } from './identity.js'
import { KNOWN, type Known } from './known.js'

/** VstPreset `<Type>` 'FBCh': the state is an opaque chunk. */
export const CHUNK_PRESET = 1178747752
/** What Live writes for a parameter value it does not know. */
export const UNKNOWN_VALUE = '0.1234567687'
export const UNSET_VISUAL_INDEX = '1073741823'

export type Blocker =
  | 'old_format'
  | 'rack'
  | 'chunk'
  | 'links'
  | 'default_links'
  | 'no_vst3'
  | 'vst3_type'

export const REASONS: Record<Blocker, string> = {
  old_format: 'file format without VST3 (Live 9 or 10.0; open and save in Live 12 first)',
  rack: 'inside a rack (macro mappings not recognized)',
  chunk: 'no plug-in state saved',
  links: 'automation/mapping, parameter ids not verified',
  default_links: 'automation/mapping on the default parameter list',
  no_vst3: 'VST3 not installed',
  vst3_type: 'VST3 type not supported',
}

const TAG_RE = /<(\/?)([A-Za-z_][\w.]*)[^>]*?(\/?)>/g
const RACK_TAG_RE =
  /<(\/?)(InstrumentGroupDevice|AudioEffectGroupDevice|DrumGroupDevice|MidiEffectGroupDevice)\b[^>]*?(\/?)>/g
const DEVICE_RE = /<PluginDevice Id="\d+">/g
const PARAM_RE = /<(Plugin\w*Parameter) Id="\d+">[\s\S]*?<\/\1>/g
const TARGET_RE = /<(?:AutomationTarget|ModulationTarget) Id="(\d+)"/g
const BRANCH_RE = /<BranchDeviceId Value="([^"]*)" \/>/
const VST_PRESET_TAG_RE = /<VstPreset(\s[^>]*)?>/y
const VST_INFO_TAG_RE = /<VstPluginInfo(\s[^>]*)?>/y
const RESETS: readonly [RegExp, string][] = [
  [/<ParameterName Value="[^"]*" \/>/g, '<ParameterName Value="" />'],
  [/<ParameterId Value="-?\d+" \/>/g, '<ParameterId Value="-1" />'],
  [/<VisualIndex Value="-?\d+" \/>/g, `<VisualIndex Value="${UNSET_VISUAL_INDEX}" />`],
  [/<Manual Value="[^"]*" \/>/g, `<Manual Value="${UNKNOWN_VALUE}" />`],
]

type Span = readonly [number, number]
type Patch = readonly [start: number, end: number, text: string]

/** Direct child elements of the content `text[start, end)` as [name, start, end]. */
function children(text: string, start: number, end: number): [string, number, number][] {
  const out: [string, number, number][] = []
  const re = new RegExp(TAG_RE.source, 'g')
  re.lastIndex = start
  let depth = 0
  let opened = 0
  for (let m = re.exec(text); m && m.index + m[0].length <= end; m = re.exec(text)) {
    const [, closing, name, selfClosing] = m as unknown as [string, string, string, string]
    if (closing) {
      depth--
      if (depth === 0) out.push([name, opened, m.index + m[0].length])
    } else if (selfClosing) {
      if (depth === 0) out.push([name, m.index, m.index + m[0].length])
    } else {
      if (depth === 0) opened = m.index
      depth++
    }
  }
  return out
}

/** Content span of the element `text[start, end)`. */
function inner(text: string, start: number, end: number): [number, number] {
  return [text.indexOf('>', start) + 1, text.lastIndexOf('<', end - 1)]
}

function child(text: string, span: Span, name: string): Span | undefined {
  const [a, b] = inner(text, span[0], span[1])
  for (const [n, s, e] of children(text, a, b)) if (n === name) return [s, e]
  return undefined
}

function indentAt(text: string, pos: number): string {
  if (pos === 0) return ''
  return text.slice(text.lastIndexOf('\n', pos - 1) + 1, pos)
}

function uidXml(fields: readonly number[], indent: string): string {
  const lines = fields.map((v, i) => `\n${indent}\t<Fields.${i} Value="${v}" />`).join('')
  return `<Uid>${lines}\n${indent}</Uid>`
}

function hexUpper(data: Uint8Array): string {
  let out = ''
  for (const b of data) out += b.toString(16).padStart(2, '0')
  return out.toUpperCase()
}

/** Binary data the way Live writes it: upper-case hex, 80 digits per line. */
function hexXml(tag: string, data: Uint8Array, indent: string): string {
  const digits = hexUpper(data)
  let lines = ''
  for (let i = 0; i < digits.length; i += 80) lines += `\n${indent}\t${digits.slice(i, i + 80)}`
  return `<${tag}>${lines}\n${indent}</${tag}>`
}

function fromHex(text: string): Uint8Array {
  const hex = text.replace(/\s+/g, '')
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex))
    throw new Error('non-hexadecimal plug-in state')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16)
  return out
}

function rackSpans(text: string): Span[] {
  const spans: Span[] = []
  const stack: number[] = []
  for (const m of text.matchAll(RACK_TAG_RE)) {
    const [, closing, , selfClosing] = m
    if (closing) {
      const start = stack.pop()
      if (start !== undefined) spans.push([start, m.index + m[0].length])
    } else if (!selfClosing) {
      stack.push(m.index)
    }
  }
  return spans
}

/** Whether the Set's file format knows VST3 devices: MinorVersion 10.0_377 (Live 10.1) or newer. */
export function supportsVst3(text: string): boolean {
  const m = /MinorVersion="(\d+)\.(\d+)_(\d+)"/.exec(text.slice(0, 2000))
  if (!m) return false
  const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return a > 10 || (a === 10 && (b > 0 || (b === 0 && c >= 377)))
}

export function targetFor(vst2Id: number, known: Known, catalog: Catalog): Target | undefined {
  if (known.vst3Uid) {
    const hit = catalog.get(known.vst3Uid)
    return hit ? new Target(known.vst3Uid, hit.devIdentifier, hit.name) : undefined
  }
  return derivedTarget(vst2Id, catalog, known.name)
}

interface Instance {
  readonly span: Span
  blocker: Blocker | ''
  readonly patches: Patch[]
  selectionReset: boolean
}

export interface PluginOutcome {
  readonly plugin: string
  readonly instances: number
  readonly converted: boolean
  /** Blockers counted per instance, in the order first seen. */
  readonly reasons: ReadonlyMap<Blocker, number>
  /** Converted instances whose custom parameter selection was reset. */
  readonly selectionsReset: number
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

/** Check one VST2 PluginDevice and prepare the patches that turn it into the VST3 version. */
function convertDevice(
  text: string,
  span: Span,
  known: Known,
  target: Target,
  pointees: ReadonlySet<string>,
): Instance {
  const inst: Instance = { span, blocker: '', patches: [], selectionReset: false }
  const desc = child(text, span, 'PluginDesc')
  const info = desc && child(text, desc, 'VstPluginInfo')
  const preset = info && child(text, info, 'Preset')
  const vstPreset = preset && child(text, preset, 'VstPreset')
  if (!info || !preset || !vstPreset) {
    inst.blocker = 'chunk'
    return inst
  }
  const [innerStart, innerEnd] = inner(text, vstPreset[0], vstPreset[1])
  const kids = children(text, innerStart, innerEnd)
  const byName = new Map<string, Span>()
  for (const [n, a, b] of kids) byName.set(n, [a, b])
  const typeSpan = byName.get('Type')
  const kind = typeSpan ? /Value="(-?\d+)"/.exec(text.slice(typeSpan[0], typeSpan[1])) : null
  const bufferSpan = byName.get('Buffer')
  if (!kind || Number(kind[1]) !== CHUNK_PRESET || !bufferSpan) {
    inst.blocker = 'chunk'
    return inst
  }
  const [bufStart, bufEnd] = inner(text, bufferSpan[0], bufferSpan[1])
  const chunk = fromHex(text.slice(bufStart, bufEnd))
  if (chunk.length === 0) {
    inst.blocker = 'chunk'
    return inst
  }
  const deviceType = target.deviceType
  if (deviceType === undefined) {
    inst.blocker = 'vst3_type'
    return inst
  }

  const params = child(text, span, 'ParameterList')
  let configured = false
  let linkedDefault = false
  let linked = false
  if (params) {
    for (const m of text.slice(params[0], params[1]).matchAll(PARAM_RE)) {
      const body = m[0]
      const isDefault = body.includes('<ParameterId Value="-1" />')
      configured ||= !isDefault
      const targets = [...body.matchAll(TARGET_RE)].map((t) => t[1] as string)
      if (body.includes('<KeyMidi>') || targets.some((t) => pointees.has(t))) {
        linked = true
        linkedDefault ||= isDefault
      }
    }
  }
  if (linked && !known.idsVerified) {
    inst.blocker = 'links'
    return inst
  }
  if (linkedDefault) {
    inst.blocker = 'default_links'
    return inst
  }

  // <VstPreset> → <Vst3Preset>: the common part, then the VST3 state instead of the VST2 chunk fields.
  const childIndent = indentAt(text, (kids[0] as [string, number, number])[1])
  const state = known.wrap ? known.wrap(chunk) : chunk
  const stateXml = sameBytes(state, chunk)
    ? `<ProcessorState>${text.slice(bufStart, bufEnd)}</ProcessorState>`
    : hexXml('ProcessorState', state, childIndent)
  const names = kids.map(([n]) => n)
  const common = kids.slice(0, names.indexOf('Type')).map(([, a, b]) => text.slice(a, b))
  const tail = (['Name', 'PresetRef'] as const)
    .filter((n) => byName.has(n))
    .map((n) => {
      const s = byName.get(n) as Span
      return text.slice(s[0], s[1])
    })
  const items = [
    ...common,
    uidXml(target.fields, childIndent),
    `<DeviceType Value="${deviceType}" />`,
    stateXml,
    '<ControllerState />',
    ...tail,
  ]
  VST_PRESET_TAG_RE.lastIndex = vstPreset[0]
  const presetAttrs = VST_PRESET_TAG_RE.exec(text)?.[1] ?? ''
  const newPreset =
    `<Vst3Preset${presetAttrs}>${items.map((x) => `\n${childIndent}${x}`).join('')}` +
    `\n${indentAt(text, vstPreset[0])}</Vst3Preset>`

  // <VstPluginInfo> → <Vst3PluginInfo>: window and audio i/o fields, the preset, then the VST3 identity.
  const [infoInnerStart, infoInnerEnd] = inner(text, info[0], info[1])
  const infoKids = new Map<string, Span>()
  for (const [n, a, b] of children(text, infoInnerStart, infoInnerEnd)) infoKids.set(n, [a, b])
  const infoIndent = indentAt(text, preset[0])
  const infoItems = [
    'WinPosX',
    'WinPosY',
    'NumAudioInputs',
    'NumAudioOutputs',
    'IsPlaceholderDevice',
  ]
    .filter((n) => infoKids.has(n))
    .map((n) => {
      const s = infoKids.get(n) as Span
      return text.slice(s[0], s[1])
    })
  infoItems.push(`<Preset>\n${indentAt(text, vstPreset[0])}${newPreset}\n${infoIndent}</Preset>`)
  infoItems.push(
    `<Name Value="${escapeAttr(target.name)}" />`,
    uidXml(target.fields, infoIndent),
    `<DeviceType Value="${deviceType}" />`,
  )
  VST_INFO_TAG_RE.lastIndex = info[0]
  const infoAttrs = VST_INFO_TAG_RE.exec(text)?.[1] ?? ''
  const newInfo =
    `<Vst3PluginInfo${infoAttrs}>${infoItems.map((x) => `\n${infoIndent}${x}`).join('')}` +
    `\n${indentAt(text, info[0])}</Vst3PluginInfo>`
  inst.patches.push([info[0], info[1], newInfo])

  const context = child(text, span, 'SourceContext')
  if (context) {
    const m = BRANCH_RE.exec(text.slice(context[0], context[1]))
    if (m) {
      const start = context[0] + m.index + m[0].indexOf('"') + 1
      inst.patches.push([start, start + (m[1] as string).length, escapeAttr(target.devIdentifier)])
    }
  }

  // Keep the parameter list only where the VST3 parameter ids are known to be the same.
  if (params && !(known.idsVerified && configured)) {
    const original = text.slice(params[0], params[1])
    let reset = original
    for (const [pattern, replacement] of RESETS) reset = reset.replace(pattern, () => replacement)
    if (reset !== original) inst.patches.push([params[0], params[1], reset])
    inst.selectionReset = configured
  }
  return inst
}

export interface ConvertResult {
  /** The converted Set text, or undefined when nothing changes. */
  readonly text: string | undefined
  readonly outcomes: PluginOutcome[]
  /** Other VST2 plug-ins with an installed VST3 that are not verified yet (name → instances). */
  readonly unchecked: ReadonlyMap<string, number>
}

export interface ConvertOptions {
  readonly known?: ReadonlyMap<number, Known>
  /** Only these plug-ins (lower-case names). */
  readonly only?: ReadonlySet<string>
}

function applyPatches(text: string, patches: readonly Patch[]): string {
  const sorted = [...patches].sort(
    (a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0),
  )
  let out = ''
  let pos = 0
  for (const [start, end, replacement] of sorted) {
    if (start < pos) throw new Error('overlapping changes')
    out += text.slice(pos, start) + replacement
    pos = end
  }
  return out + text.slice(pos)
}

function countOf(text: string, needle: string): number {
  let n = 0
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) n++
  return n
}

/** Convert every convertible VST2 plug-in of a Set. */
export function convertText(
  text: string,
  catalog: Catalog,
  options: ConvertOptions = {},
): ConvertResult {
  const known = options.known ?? KNOWN
  const vst3Format = supportsVst3(text)
  const pointees = new Set(
    [...text.matchAll(/<PointeeId Value="(\d+)"/g)].map((m) => m[1] as string),
  )
  const racks = rackSpans(text)
  const instances = new Map<string, Instance[]>()
  const unchecked = new Map<string, number>()
  for (const m of text.matchAll(DEVICE_RE)) {
    const end = text.indexOf('</PluginDevice>', m.index)
    if (end < 0) continue
    const span: Span = [m.index, end + '</PluginDevice>'.length]
    const presetAt = text.indexOf('<Preset>', span[0])
    const head = text.slice(span[0], presetAt !== -1 && presetAt < span[1] ? presetAt : span[1])
    if (!head.includes('<VstPluginInfo')) continue
    const uid = /<UniqueId Value="(-?\d+)" \/>/.exec(head)
    const vst2Id = uid ? Number(uid[1]) : 0
    const entry = known.get(vst2Id)
    if (!entry) {
      if (vst2Id && derivedTarget(vst2Id, catalog)) {
        const name = /<PlugName Value="([^"]*)" \/>/.exec(head)
        const key = name ? decodeEntities(name[1] as string) : String(vst2Id)
        unchecked.set(key, (unchecked.get(key) ?? 0) + 1)
      }
      continue
    }
    if (options.only && options.only.size > 0 && !options.only.has(entry.name.toLowerCase()))
      continue
    const target = targetFor(vst2Id, entry, catalog)
    let inst: Instance
    if (!vst3Format) inst = { span, blocker: 'old_format', patches: [], selectionReset: false }
    else if (racks.some(([a, b]) => a < span[0] && span[0] < b))
      inst = { span, blocker: 'rack', patches: [], selectionReset: false }
    else if (!target) inst = { span, blocker: 'no_vst3', patches: [], selectionReset: false }
    else inst = convertDevice(text, span, entry, target, pointees)
    const list = instances.get(entry.name) ?? []
    list.push(inst)
    instances.set(entry.name, list)
  }

  const outcomes: PluginOutcome[] = []
  const patches: Patch[] = []
  for (const [plugin, found] of instances) {
    const reasons = new Map<Blocker, number>()
    for (const i of found) if (i.blocker) reasons.set(i.blocker, (reasons.get(i.blocker) ?? 0) + 1)
    const converted = reasons.size === 0
    if (converted) for (const i of found) patches.push(...i.patches)
    outcomes.push({
      plugin,
      instances: found.length,
      converted,
      reasons,
      selectionsReset: converted ? found.filter((i) => i.selectionReset).length : 0,
    })
  }
  if (patches.length === 0) return { text: undefined, outcomes, unchecked }

  const newText = applyPatches(text, patches)
  const newBytes = encodeUtf8(newText)
  scan(newBytes, { strict: true }) // well-formed or throws
  const converted = outcomes.filter((o) => o.converted).reduce((n, o) => n + o.instances, 0)
  const refsBefore = fileRefs(documentFromXml(encodeUtf8(text), false, false)).length
  const refsAfter = fileRefs(documentFromXml(newBytes, false, false)).length
  if (
    (newText.match(DEVICE_RE)?.length ?? 0) !== (text.match(DEVICE_RE)?.length ?? 0) ||
    countOf(newText, '<Vst3PluginInfo') !== countOf(text, '<Vst3PluginInfo') + converted ||
    refsAfter !== refsBefore
  ) {
    throw new Error('conversion check failed')
  }
  return { text: newText, outcomes, unchecked }
}

/** The reasons as one text: "<reason> ×n, …", most frequent first. */
export function reasonsText(reasons: ReadonlyMap<Blocker, number>): string {
  return [...reasons.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${REASONS[k]} ×${n}`)
    .join(', ')
}
