import { decodeEntities, decodeUtf8, type El, scan, type XmlIndex } from '@livesaver/xml'
import type { Codec } from './host.js'
import { type ByteSearch, searchBytes } from './search.js'

/** Not a readable Ableton Live document. */
export class LiveFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LiveFormatError'
  }
}

/** A decoded Live document (.als/.adg/.adv/.alc/.agr). */
export interface LiveDoc {
  /** The decompressed XML. */
  readonly xml: Uint8Array
  /** Whether the file was gzip-compressed (Live always compresses; plain XML is accepted). */
  readonly gzipped: boolean
  /** Full element index, built on first use (reading references does not need it). */
  readonly index: XmlIndex
  readonly root: El
  /** `Creator`, e.g. "Ableton Live 12.4.6" ('' if absent). */
  readonly creator: string
  readonly majorVersion: string
  /** e.g. "12.0_12402", "10.0_377". */
  readonly minorVersion: string
  /** Byte search used for targeted reads (native when the host provides one). */
  readonly search: ByteSearch
}

const GZIP_0 = 0x1f
const GZIP_1 = 0x8b

function isAsciiSpace(c: number | undefined): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0b || c === 0x0c
}

/** Whether the bytes start (after ASCII whitespace or a UTF-8 BOM) with `<?xml`. */
export function looksLikeXml(bytes: Uint8Array): boolean {
  let i = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0
  while (isAsciiSpace(bytes[i])) i++
  return (
    bytes[i] === 0x3c &&
    bytes[i + 1] === 0x3f &&
    bytes[i + 2] === 0x78 &&
    bytes[i + 3] === 0x6d &&
    bytes[i + 4] === 0x6c
  )
}

/** Attributes of the root element's start tag, read without scanning the document. */
function rootAttributes(xml: Uint8Array): Record<string, string> {
  let i = 0
  for (;;) {
    i = xml.indexOf(0x3c, i)
    if (i < 0) return {}
    const next = xml[i + 1]
    if (next !== 0x3f && next !== 0x21) break
    i++
  }
  // Find the end of the start tag, skipping '>' inside quoted values.
  let quote = 0
  let end = i + 1
  for (; end < xml.length; end++) {
    const c = xml[end] as number
    if (quote) {
      if (c === quote) quote = 0
    } else if (c === 0x22 || c === 0x27) {
      quote = c
    } else if (c === 0x3e) {
      break
    }
  }
  const tag = decodeUtf8(xml, i, end)
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    out[m[1] as string] = decodeEntities((m[2] ?? m[3]) as string)
  }
  return out
}

class Document implements LiveDoc {
  readonly xml: Uint8Array
  readonly gzipped: boolean
  readonly creator: string
  readonly majorVersion: string
  readonly minorVersion: string
  readonly search: ByteSearch
  private built: XmlIndex | undefined

  constructor(xml: Uint8Array, gzipped: boolean, search: ByteSearch, index?: XmlIndex) {
    this.xml = xml
    this.gzipped = gzipped
    this.search = search
    this.built = index
    const attrs = rootAttributes(xml)
    this.creator = attrs.Creator ?? ''
    this.majorVersion = attrs.MajorVersion ?? ''
    this.minorVersion = attrs.MinorVersion ?? ''
  }

  get index(): XmlIndex {
    if (!this.built) {
      try {
        this.built = scan(this.xml, { strict: false })
      } catch (error) {
        throw new LiveFormatError(`XML: ${(error as Error).message}`)
      }
    }
    return this.built
  }

  get root(): El {
    return this.index.root
  }
}

export interface OpenOptions {
  /** Native byte search (e.g. Buffer#indexOf); a pure Boyer–Moore–Horspool is used otherwise. */
  readonly search?: ByteSearch
}

/** Decode a Live file: gunzip if needed and check that it is XML. The element index is lazy. */
export async function openDocument(
  file: Uint8Array,
  codec: Codec,
  options: OpenOptions = {},
): Promise<LiveDoc> {
  if (file[0] === 0xab && file[1] === 0x1e) {
    throw new LiveFormatError('binary Live document (before Live 8.2); not supported')
  }
  const gzipped = file[0] === GZIP_0 && file[1] === GZIP_1
  let xml: Uint8Array
  try {
    xml = gzipped ? await codec.gunzip(file) : file
  } catch (error) {
    throw new LiveFormatError(`gzip: ${(error as Error).message}`)
  }
  if (!looksLikeXml(xml)) throw new LiveFormatError('not an Ableton XML document')
  return new Document(xml, gzipped, options.search ?? searchBytes)
}

/**
 * A document from XML bytes already in memory (e.g. a patched set). With `strict` (default) the
 * whole document is scanned right away and must be well-formed.
 */
export function documentFromXml(
  xml: Uint8Array,
  gzipped: boolean,
  strict = true,
  search: ByteSearch = searchBytes,
): LiveDoc {
  return new Document(xml, gzipped, search, strict ? scan(xml, { strict: true }) : undefined)
}

/** Encode patched XML like the original file: gzip level 6, mtime 0; verified by inflating it again. */
export async function encodeDocument(
  doc: LiveDoc,
  xml: Uint8Array,
  codec: Codec,
): Promise<Uint8Array> {
  if (!doc.gzipped) return xml
  const data = await codec.gzip(xml, 6)
  const back = await codec.gunzip(data)
  if (back.length !== xml.length || !back.every((b, i) => b === xml[i])) {
    throw new LiveFormatError('gzip check failed')
  }
  return data
}

/**
 * Compare Live's MinorVersion strings ("10.0_377" < "10.0_1000" < "11.0_433"): numerically by the
 * version before `_`, then by the build number after it.
 */
export function compareMinorVersion(a: string, b: string): number {
  const parse = (v: string): number[] => {
    const [ver = '', build = ''] = v.split('_')
    return [
      ...ver.split('.').map((x) => Number.parseInt(x, 10) || 0),
      Number.parseInt(build, 10) || 0,
    ]
  }
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}
