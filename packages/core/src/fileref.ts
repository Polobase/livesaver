/**
 * FileRefs of samples and Max for Live devices: parsing and patching.
 *
 * References are located with byte searches (`<SampleRef>`, `<MxPatchRef>`, `<MxDPatchRef>`
 * followed by `<FileRef>`), with byte offsets and without a full parse. Inside the small FileRef
 * body, values are read with simple patterns on the decoded text, and patches replace exactly the
 * bytes of the values they change.
 */
import { decodeEntities, decodeUtf8, escapeAttr, type Span } from '@livesaver/xml'
import { pyInt } from './compat.js'
import { type LiveDoc, LiveFormatError } from './document.js'
import { MAC_ROMAN_HIGH } from './macroman.generated.js'
import { splitPath } from './path.js'

/** RelativePathType values (see docs/format/fileref.md). */
export const REL_NONE = 0
export const REL_DOCUMENT = 1
export const REL_OLD_LIBRARY = 2
export const REL_PROJECT = 3
export const REL_PACK = 5
export const REL_USER_LIBRARY = 6
export const REL_BUILTIN = 7

export const CORE_LIBRARY_PACK_ID = 'www.ableton.com/0'

export type RefContainer = 'SampleRef' | 'MxPatchRef' | 'MxDPatchRef'
export type RefKind = 'sample' | 'device'
export type RefFormat = 'new' | 'old'

/** One `<FileRef>` of a sample or Max device. */
export interface FileRef {
  readonly container: RefContainer
  readonly kind: RefKind
  readonly format: RefFormat
  /** Bytes between `<FileRef>` and `</FileRef>`. */
  readonly bodySpan: Span
  /** Bytes of the sibling `<LastModDate Value="…" />` value, if present. */
  readonly lastModSpan: Span | undefined
  readonly relType: number
  /** Directories of the relative path; `..` for up. */
  readonly relDirs: readonly string[]
  readonly name: string
  /** Stored absolute path ('' if unknown); may be a Windows path. */
  readonly path: string
  /** 0 = unknown. */
  readonly size: number
  /** 0 = unknown. */
  readonly crc: number
  readonly packName: string
  readonly packId: string
  readonly lastMod: string
  /** Old format: "/" + PathHint dirs + "/" + Name. */
  readonly hintPath: string
  /** `relDirs` + name joined with "/" ('' without a name). */
  readonly relPath: string
  /** Identity: references with equal keys resolve identically (counted once per set). */
  readonly key: string
}

/** Absolute paths stored in the reference, most specific first. */
export function storedPaths(ref: Pick<FileRef, 'path' | 'hintPath'>): string[] {
  return [ref.path, ref.hintPath].filter((p) => p)
}

const FILE_REF_OPEN = new TextEncoder().encode('<FileRef>')
const FILE_REF_CLOSE = new TextEncoder().encode('</FileRef>')
const LAST_MOD_PREFIX = new TextEncoder().encode('<LastModDate Value="')
const CONTAINER_NAMES: readonly [RefContainer, Uint8Array][] = (
  ['SampleRef', 'MxPatchRef', 'MxDPatchRef'] as const
).map((name) => [name, new TextEncoder().encode(name)])
const ID_ATTR = new TextEncoder().encode(' Id="')

/**
 * The container whose start tag occupies `bytes[lt..gt]`: exactly `<Name>` or `<Name Id="digits">`
 * (`<(SampleRef|MxPatchRef|MxDPatchRef)(?: Id="\d+")?>` followed by `<FileRef>`).
 */
function containerAt(bytes: Uint8Array, lt: number, gt: number): RefContainer | undefined {
  for (const [name, raw] of CONTAINER_NAMES) {
    if (!startsWithAt(bytes, lt + 1, raw)) continue
    const after = lt + 1 + raw.length
    if (after === gt) return name
    if (!startsWithAt(bytes, after, ID_ATTR)) return undefined
    let k = after + ID_ATTR.length
    const first = k
    while ((bytes[k] as number) >= 0x30 && (bytes[k] as number) <= 0x39) k++
    return k > first && bytes[k] === 0x22 && k + 1 === gt ? name : undefined
  }
  return undefined
}

function isAsciiSpace(c: number | undefined): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0b || c === 0x0c
}

function startsWithAt(bytes: Uint8Array, at: number, prefix: Uint8Array): boolean {
  if (at + prefix.length > bytes.length) return false
  for (let k = 0; k < prefix.length; k++) if (bytes[at + k] !== prefix[k]) return false
  return true
}

/**
 * Every sample and Max device reference, in document order.
 *
 * Mirrors `SAMPLE_REF_RE` byte for byte without scanning the whole document: each `<FileRef>` is
 * found with a byte search and accepted only if whitespace separates it from a preceding
 * `<SampleRef>`, `<MxPatchRef Id="n">` or `<MxDPatchRef Id="n">` start tag; the body runs to the
 * next `</FileRef>`, optionally followed by whitespace and `<LastModDate Value="…" />`.
 */
export function fileRefs(doc: LiveDoc): FileRef[] {
  const bytes = doc.xml
  const find = doc.search(bytes)
  const out: FileRef[] = []
  let pos = 0
  for (;;) {
    const open = find(FILE_REF_OPEN, pos)
    if (open < 0) break
    pos = open + FILE_REF_OPEN.length
    let i = open - 1
    while (i >= 0 && isAsciiSpace(bytes[i])) i--
    if (i < 0 || bytes[i] !== 0x3e) continue
    const lt = bytes.lastIndexOf(0x3c, i)
    if (lt < 0 || i - lt > 64) continue
    const container = containerAt(bytes, lt, i)
    if (!container) continue
    const bodyStart = open + FILE_REF_OPEN.length
    const close = find(FILE_REF_CLOSE, bodyStart)
    if (close < 0) break
    pos = close + FILE_REF_CLOSE.length

    let lastModSpan: Span | undefined
    let j = pos
    while (isAsciiSpace(bytes[j])) j++
    if (startsWithAt(bytes, j, LAST_MOD_PREFIX)) {
      const valueStart = j + LAST_MOD_PREFIX.length
      const valueEnd = bytes.indexOf(0x22, valueStart)
      if (
        valueEnd >= 0 &&
        bytes[valueEnd + 1] === 0x20 &&
        bytes[valueEnd + 2] === 0x2f &&
        bytes[valueEnd + 3] === 0x3e
      ) {
        lastModSpan = { start: valueStart, end: valueEnd }
        pos = valueEnd + 4
      }
    }
    const bodySpan = { start: bodyStart, end: close }
    const body = decodeUtf8(bytes, bodyStart, close)
    const values = valuesOf(body)
    const common = {
      container,
      kind: (container === 'SampleRef' ? 'sample' : 'device') as RefKind,
      bodySpan,
      lastModSpan,
      relType: pyInt(values.get('RelativePathType', '0')),
      packName: values.get('LivePackName'),
      packId: values.get('LivePackId'),
      lastMod: lastModSpan ? decodeUtf8(bytes, lastModSpan.start, lastModSpan.end) : '',
    }
    out.push(
      body.includes('<HasRelativePath ')
        ? parseOld(body, values, common)
        : parseNew(values, common),
    )
  }
  return out
}

type Common = Pick<
  FileRef,
  'container' | 'kind' | 'bodySpan' | 'lastModSpan' | 'relType' | 'packName' | 'packId' | 'lastMod'
>

function finish(
  common: Common,
  rest: Pick<FileRef, 'format' | 'relDirs' | 'name' | 'path' | 'size' | 'crc' | 'hintPath'>,
): FileRef {
  const relPath = rest.name ? [...rest.relDirs, rest.name].join('/') : ''
  const key = JSON.stringify([
    common.kind,
    rest.format,
    common.relType,
    relPath,
    rest.path,
    rest.hintPath,
    rest.size,
    rest.crc,
    common.packName,
    common.packId,
  ])
  return { ...common, ...rest, relPath, key }
}

function parseNew(values: Values, common: Common): FileRef {
  const rel = values.get('RelativePath')
  const path = values.get('Path')
  const parts = rel ? rel.split('/').filter((p) => p) : []
  const pathParts = splitPath(path)
  const name =
    parts.length > 0 ? (parts.at(-1) as string) : ((pathParts.at(-1) as string | undefined) ?? '')
  return finish(common, {
    format: 'new',
    relDirs: parts.slice(0, -1),
    name,
    path,
    size: pyInt(values.get('OriginalFileSize', '0')),
    crc: pyInt(values.get('OriginalCrc', '0')),
    hintPath: '',
  })
}

function parseOld(body: string, values: Values, common: Common): FileRef {
  const name = values.get('Name')
  const hasRel = values.get('HasRelativePath') === 'true'
  const relSection = section(body, 'RelativePath')
  let relDirs: string[] = []
  if (hasRel && relSection) relDirs = elements(relSection.inner).map((e) => e.Dir || '..')
  const hintSection = section(body, 'PathHint')
  const hintDirs = elements(hintSection?.inner).map((e) => e.Dir ?? '')
  const hintPath = hintDirs.length > 0 && name ? `/${[...hintDirs, name].join('/')}` : ''
  const data = /<Data>([\s\S]*?)<\/Data>/.exec(body)
  return finish(common, {
    format: 'old',
    relDirs: hasRel ? relDirs : [],
    name,
    path: data ? decodeData(data[1] as string) : '',
    size: pyInt(values.get('FileSize', '0')),
    crc: pyInt(values.get('Crc', '0')),
    hintPath,
  })
}

// ---------------------------------------------------------------- body-level helpers

const valueRes = new Map<string, RegExp>()

function valueRe(tag: string): RegExp {
  let re = valueRes.get(tag)
  if (!re) {
    re = new RegExp(`<${tag} Value=(?:"([^"]*)"|'([^']*)') />`)
    valueRes.set(tag, re)
  }
  return re
}

/** The first `<Tag Value="…" />` of every tag in a body, collected in one pass. */
interface Values {
  get(tag: string, fallback?: string): string
}

const VALUE_ELEMENT_RE = /<(\w+) Value=(?:"([^"]*)"|'([^']*)') \/>/g

/**
 * Same result as calling `value(body, tag)` for each tag: a `<Tag Value=… />` element can never
 * contain another one (values hold no `<`), so the first match per tag name is the first match of
 * that tag's own regex.
 */
function valuesOf(body: string): Values {
  const raw = new Map<string, string>()
  for (const m of body.matchAll(VALUE_ELEMENT_RE)) {
    const tag = m[1] as string
    if (!raw.has(tag)) raw.set(tag, (m[2] ?? m[3]) as string)
  }
  return {
    get: (tag, fallback = '') => {
      const v = raw.get(tag)
      return v === undefined ? fallback : decodeEntities(v)
    },
  }
}

/** First `<tag Value="…" />` in the body, unescaped. */
export function value(body: string, tag: string, fallback = ''): string {
  const m = valueRe(tag).exec(body)
  if (!m) return fallback
  return decodeEntities((m[1] ?? m[2]) as string)
}

interface Section {
  readonly start: number
  readonly end: number
  /** Content of `<tag>…</tag>`; undefined for `<tag />`. */
  readonly inner: string | undefined
}

const sectionRes = new Map<string, RegExp>()

/** First `<tag>…</tag>` or `<tag />` in the body. */
function section(body: string, tag: string): Section | undefined {
  let re = sectionRes.get(tag)
  if (!re) {
    re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>|<${tag} />`)
    sectionRes.set(tag, re)
  }
  const m = re.exec(body)
  if (!m) return undefined
  return { start: m.index, end: m.index + m[0].length, inner: m[1] }
}

const ELEMENT_RE = /<RelativePathElement((?:\s+\w+=(?:"[^"]*"|'[^']*'))*)\s*\/>/g
const ATTR_RE = /(\w+)=(?:"([^"]*)"|'([^']*)')/g

/** Attributes of the RelativePathElements in a list section. */
function elements(inner: string | undefined): Record<string, string>[] {
  const out: Record<string, string>[] = []
  for (const m of (inner ?? '').matchAll(ELEMENT_RE)) {
    const attrs: Record<string, string> = {}
    for (const a of (m[1] as string).matchAll(ATTR_RE)) {
      attrs[a[1] as string] = decodeEntities((a[2] ?? a[3]) as string)
    }
    out.push(attrs)
  }
  return out
}

// ------------------------------------------------------------------------------- Data (old format)

const utf16 = new TextDecoder('utf-16le')
const utf8 = new TextDecoder('utf-8')

/** Absolute path stored in an old-format `<Data>` element (Windows path or Mac alias), or ''. */
export function decodeData(hexText: string): string {
  const raw = hexToBytes(hexText)
  if (!raw) return ''
  if (raw.length >= 6 && raw[1] === 0 && raw[2] === 0x3a && raw[3] === 0) {
    const text = utf16.decode(raw)
    const nul = text.indexOf('\u0000')
    return nul < 0 ? text : text.slice(0, nul)
  }
  return aliasPosixPath(raw)
}

const HEX = (() => {
  const t = new Int8Array(128).fill(-1)
  for (let i = 0; i < 10; i++) t[0x30 + i] = i
  for (let i = 0; i < 6; i++) {
    t[0x41 + i] = 10 + i
    t[0x61 + i] = 10 + i
  }
  return t
})()

/** Hex digits to bytes, ignoring whitespace (Python `bytes.fromhex("".join(text.split()))`). */
function hexToBytes(text: string): Uint8Array | undefined {
  const out = new Uint8Array(text.length >> 1)
  let n = 0
  let high = -1
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 0x20 || (c >= 0x09 && c <= 0x0d)) continue
    const v = c < 128 ? (HEX[c] as number) : -1
    if (v < 0) {
      if (/\s/.test(text[i] as string)) continue
      return undefined
    }
    if (high < 0) high = v
    else {
      out[n++] = (high << 4) | v
      high = -1
    }
  }
  return high < 0 ? out.subarray(0, n) : undefined
}

function u16be(raw: Uint8Array, at: number): number {
  return (((raw[at] as number) << 8) | (raw[at + 1] as number)) & 0xffff
}

/** POSIX path from a classic Mac alias record, version 2. */
function aliasPosixPath(raw: Uint8Array): string {
  if (raw.length < 150 || u16be(raw, 6) !== 2) return ''
  const tags = new Map<number, Uint8Array>()
  let pos = 150
  while (pos + 4 <= raw.length) {
    const tag = (u16be(raw, pos) << 16) >> 16
    const length = u16be(raw, pos + 2)
    if (tag === -1) break
    tags.set(tag, raw.subarray(pos + 4, pos + 4 + length))
    pos += 4 + length + (length & 1)
  }
  const posix = tags.get(0x12)
  if (posix) {
    const rel = utf8.decode(posix).replace(/^\/+/, '')
    const mountBytes = tags.get(0x13)
    const mount = (mountBytes ? utf8.decode(mountBytes) : '/') || '/'
    return `${mount.replace(/\/+$/, '')}/${rel}`
  }
  const hfs = tags.get(2)
  if (hfs) {
    let text = ''
    for (const b of hfs)
      text += b < 0x80 ? String.fromCharCode(b) : (MAC_ROMAN_HIGH[b - 0x80] as string)
    return `/${text.split(':').slice(1).join('/')}`
  }
  return ''
}

// ----------------------------------------------------------------------------------------- patching

const ELEMENT_ID = new TextEncoder().encode('<RelativePathElement Id="')

/** Fresh `RelativePathElement` Ids above all Ids in the document. */
export class RelPathIds {
  readonly usesIds: boolean
  private next: number

  constructor(usesIds: boolean, next: number) {
    this.usesIds = usesIds
    this.next = next
  }

  /** All `<RelativePathElement Id="N"` in the document. */
  static of(doc: LiveDoc): RelPathIds {
    const bytes = doc.xml
    let max = -1
    let any = false
    const find = doc.search(bytes)
    for (let pos = find(ELEMENT_ID, 0); pos >= 0; pos = find(ELEMENT_ID, pos + 1)) {
      let k = pos + ELEMENT_ID.length
      let n = 0
      const first = k
      while ((bytes[k] as number) >= 0x30 && (bytes[k] as number) <= 0x39)
        n = n * 10 + ((bytes[k++] as number) - 0x30)
      if (k === first || bytes[k] !== 0x22) continue
      any = true
      if (n > max) max = n
    }
    return new RelPathIds(any || doc.creator.startsWith('Ableton Live 10'), max + 1)
  }

  take(): number {
    return this.next++
  }
}

function setValue(body: string, tag: string, newValue: string): string {
  const m = valueRe(tag).exec(body)
  if (!m) throw new LiveFormatError(`<${tag}> missing in FileRef`)
  return `${body.slice(0, m.index)}<${tag} Value="${escapeAttr(newValue)}" />${body.slice(m.index + m[0].length)}`
}

export interface Pack {
  readonly name: string
  readonly id: string
}

function setPack(body: string, pack: Pack | undefined): string {
  if (!pack) return body
  return setValue(setValue(body, 'LivePackName', pack.name), 'LivePackId', pack.id)
}

/**
 * Point a Live 11/12 FileRef body at a file. `relPath` is relative to the project (REL_PROJECT),
 * the pack (REL_PACK) or the set's folder (REL_DOCUMENT). The fingerprint stays untouched.
 */
export function patchNew(
  body: string,
  relType: number,
  relPath: string,
  absPath: string,
  pack?: Pack,
): string {
  let out = setValue(body, 'RelativePathType', String(relType))
  out = setValue(out, 'RelativePath', relPath)
  return setPack(setValue(out, 'Path', absPath), pack)
}

function replaceList(body: string, tag: string, dirs: readonly string[], ids: RelPathIds): string {
  const sec = section(body, tag)
  if (!sec) throw new LiveFormatError(`<${tag}> missing in FileRef`)
  const oldIds = elements(sec.inner)
    .filter((e) => 'Id' in e)
    .map((e) => e.Id as string)
  const lineStart = sec.start === 0 ? 0 : body.lastIndexOf('\n', sec.start - 1) + 1
  const indent = body.slice(lineStart, sec.start)
  let replacement: string
  if (dirs.length === 0) {
    replacement = `<${tag} />`
  } else {
    const lines = dirs.map((d, i) => {
      const id = ids.usesIds ? ` Id="${i < oldIds.length ? oldIds[i] : ids.take()}"` : ''
      return `${indent}\t<RelativePathElement${id} Dir="${escapeAttr(d)}" />`
    })
    replacement = `<${tag}>\n${lines.join('\n')}\n${indent}</${tag}>`
  }
  return body.slice(0, sec.start) + replacement + body.slice(sec.end)
}

/**
 * Point a Live 8.2–10 FileRef body at a file (see `patchNew`); `..` is written as `Dir=""`.
 * `Data`, `Type`, `FileSize` and `Crc` stay untouched.
 */
export function patchOld(
  body: string,
  relType: number,
  relDirs: readonly string[],
  name: string,
  absDirs: readonly string[],
  ids: RelPathIds,
  pack?: Pack,
): string {
  let out = setValue(body, 'HasRelativePath', 'true')
  out = setValue(out, 'RelativePathType', String(relType))
  out = replaceList(
    out,
    'RelativePath',
    relDirs.map((d) => (d === '..' ? '' : d)),
    ids,
  )
  out = setValue(out, 'Name', name)
  if (section(out, 'PathHint')) out = replaceList(out, 'PathHint', absDirs, ids)
  return setPack(out, pack)
}
