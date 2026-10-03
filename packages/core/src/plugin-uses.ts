/**
 * The plug-ins a Set uses, read without scanning the whole document: the plug-in devices are
 * found by byte search, and only their elements are scanned. A Set is mostly clips and
 * automation, so this is many times faster than the element index of the whole file, and the
 * audit of a library need not read every Set a second time.
 *
 * Plug-in devices below `Ableton/LiveSet`:
 * - `PluginDevice/PluginDesc/VstPluginInfo` (VST2: `UniqueId`, `PlugName`) or
 *   `…/Vst3PluginInfo` (VST3: `Uid/Fields.0–3`, `Name`)
 * - `AuPluginDevice/PluginDesc/AuPluginInfo` (`ComponentType`, `ComponentSubType`,
 *   `ComponentManufacturer`, `Name`)
 */
import { decodeEntities, decodeUtf8, type El, scan, type XmlIndex } from '@livesaver/xml'
import { pyStrip } from './compat.js'
import type { LiveDoc } from './document.js'

export type PluginFormat = 'VST2' | 'VST3' | 'AU'

/** A plug-in as the Set refers to it; Live finds it by format and id, never by name. */
export interface PluginRef {
  readonly format: PluginFormat
  /** VST2: unique id (decimal), VST3: class id (32 hex digits), AU: "type:subtype:manufacturer". */
  readonly ident: string
  readonly name: string
}

export interface PluginUseCount {
  readonly ref: PluginRef
  readonly instances: number
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

export function strictInt(text: string): number | undefined {
  const t = pyStrip(text)
  return /^[+-]?\d+(?:_\d+)*$/.test(t) ? Number(t.replaceAll('_', '')) : undefined
}

/** Attribute value as ElementTree reports it (XML attribute-value normalization, then entities). */
export function etAttr(ix: XmlIndex, el: El, name: string): string | undefined {
  const span = ix.attrSpan(el, name)
  if (!span) return undefined
  const raw = decodeUtf8(ix.bytes, span.start, span.end)
    .replaceAll('\r\n', '\n')
    .replace(/[\t\n\r]/g, ' ')
  return raw.includes('&') ? decodeEntities(raw) : raw
}

function valueAt(ix: XmlIndex, el: El, path: string, fallback = ''): string {
  const found = ix.find(el, path)
  return found === undefined ? fallback : (etAttr(ix, found, 'Value') ?? fallback)
}

/** The VST2 or VST3 plug-in of a `PluginDevice` element, if it names one. */
export function vstRefOf(ix: XmlIndex, device: El): PluginRef | undefined {
  const vst = ix.find(device, 'PluginDesc/VstPluginInfo')
  if (vst !== undefined) {
    const id = strictInt(valueAt(ix, vst, 'UniqueId', '0'))
    if (id === undefined) return undefined
    return { format: 'VST2', ident: String(id >>> 0), name: valueAt(ix, vst, 'PlugName') }
  }
  const vst3 = ix.find(device, 'PluginDesc/Vst3PluginInfo')
  if (vst3 === undefined) return undefined
  const uid = ix.find(vst3, 'Uid')
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
  if (parts.length < 4) return undefined
  return { format: 'VST3', ident: parts.join(''), name: valueAt(ix, vst3, 'Name') }
}

/** The Audio Unit of an `AuPluginDevice` element, if it names one. */
export function auRefOf(ix: XmlIndex, device: El): PluginRef | undefined {
  const au = ix.find(device, 'PluginDesc/AuPluginInfo')
  if (au === undefined) return undefined
  const codes = ['ComponentType', 'ComponentSubType', 'ComponentManufacturer'].map((t) =>
    strictInt(valueAt(ix, au, t, '0')),
  )
  if (codes.some((c) => c === undefined)) return undefined
  return {
    format: 'AU',
    ident: codes.map((c) => idCode(c as number)).join(':'),
    name: valueAt(ix, au, 'Name'),
  }
}

/** Instances per plug-in, in order of first appearance. */
export function countPlugins(refs: Iterable<PluginRef>): PluginUseCount[] {
  const plugins = new Map<string, { ref: PluginRef; instances: number }>()
  for (const ref of refs) {
    const key = `${ref.format}\u0000${ref.ident}\u0000${ref.name}`
    const hit = plugins.get(key)
    if (hit) hit.instances++
    else plugins.set(key, { ref, instances: 1 })
  }
  return [...plugins.values()]
}

const encode = (text: string) => new TextEncoder().encode(text)
/** Both device elements end in this name, so one pass over the document finds them all. */
const NAME = encode('PluginDevice')
const CLOSE = { vst: encode('</PluginDevice>'), au: encode('</AuPluginDevice>') }
const LT = 0x3c
const GT = 0x3e
const SLASH = 0x2f

const endsName = (c: number | undefined) =>
  c === GT || c === SLASH || c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d

/**
 * The plug-ins of a Set with their instance counts: all `PluginDevice`s first, then all
 * `AuPluginDevice`s, as `analyzeSet` lists them. Throws if a device element is not well-formed.
 */
export function pluginUses(doc: LiveDoc): PluginUseCount[] {
  const bytes = doc.xml
  const find = doc.search(bytes)
  const vst: PluginRef[] = []
  const au: PluginRef[] = []
  let pos = 0
  for (;;) {
    const at = find(NAME, pos)
    if (at < 0) break
    pos = at + NAME.length
    if (!endsName(bytes[pos])) continue
    let open: number
    let kind: 'vst' | 'au'
    if (bytes[at - 1] === LT) {
      open = at - 1
      kind = 'vst'
    } else if (bytes[at - 3] === LT && bytes[at - 2] === 0x41 && bytes[at - 1] === 0x75) {
      open = at - 3
      kind = 'au'
    } else continue // a closing tag, or the end of another element's name
    const tagEnd = bytes.indexOf(GT, pos)
    if (tagEnd < 0) break
    if (bytes[tagEnd - 1] === SLASH) continue // an empty element names no plug-in
    const close = find(CLOSE[kind], tagEnd)
    if (close < 0) throw new Error('a plug-in device element is not closed')
    pos = close + CLOSE[kind].length
    const ix = scan(bytes.subarray(open, pos), { strict: true })
    const ref = kind === 'vst' ? vstRefOf(ix, ix.root) : auRefOf(ix, ix.root)
    if (ref) (kind === 'vst' ? vst : au).push(ref)
  }
  return countPlugins([...vst, ...au])
}
