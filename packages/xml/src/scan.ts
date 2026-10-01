import { FNV_OFFSET, FNV_PRIME, NameTable } from './names.js'
import { XmlIndex } from './xml-index.js'

/** Malformed XML, with the byte offset where the scanner gave up. */
export class XmlSyntaxError extends Error {
  readonly offset: number
  constructor(message: string, offset: number) {
    super(`${message} (byte ${offset})`)
    this.name = 'XmlSyntaxError'
    this.offset = offset
  }
}

export interface ScanOptions {
  /**
   * Strict mode (default) rejects everything a conforming parser would: mismatched end tags,
   * `<` inside attribute values, missing whitespace between attributes, text outside the root,
   * several roots. Use it for every document livesaver writes.
   */
  readonly strict?: boolean
}

/**
 * Element and attribute tables in document (pre-)order, as parallel typed arrays.
 * Element `i`'s descendants are exactly `i + 1 … subtreeEnd[i] - 1`.
 */
export class Tables {
  count = 0
  start: Uint32Array
  openEnd: Uint32Array
  end: Uint32Array
  name: Uint32Array
  parent: Int32Array
  subtreeEnd: Uint32Array
  attrFirst: Uint32Array
  attrLen: Uint32Array

  attrCount = 0
  attrName: Uint32Array
  attrValStart: Uint32Array
  attrValEnd: Uint32Array

  constructor(elements: number, attributes: number) {
    this.start = new Uint32Array(elements)
    this.openEnd = new Uint32Array(elements)
    this.end = new Uint32Array(elements)
    this.name = new Uint32Array(elements)
    this.parent = new Int32Array(elements)
    this.subtreeEnd = new Uint32Array(elements)
    this.attrFirst = new Uint32Array(elements)
    this.attrLen = new Uint32Array(elements)
    this.attrName = new Uint32Array(attributes)
    this.attrValStart = new Uint32Array(attributes)
    this.attrValEnd = new Uint32Array(attributes)
  }

  pushElement(start: number, name: number, parent: number): number {
    if (this.count === this.start.length) this.growElements()
    const i = this.count++
    this.start[i] = start
    this.name[i] = name
    this.parent[i] = parent
    this.attrFirst[i] = this.attrCount
    return i
  }

  pushAttribute(name: number, valueStart: number, valueEnd: number): void {
    if (this.attrCount === this.attrName.length) this.growAttributes()
    const i = this.attrCount++
    this.attrName[i] = name
    this.attrValStart[i] = valueStart
    this.attrValEnd[i] = valueEnd
  }

  private growElements(): void {
    const n = this.start.length * 2
    this.start = grow32(this.start, n)
    this.openEnd = grow32(this.openEnd, n)
    this.end = grow32(this.end, n)
    this.name = grow32(this.name, n)
    this.subtreeEnd = grow32(this.subtreeEnd, n)
    this.attrFirst = grow32(this.attrFirst, n)
    this.attrLen = grow32(this.attrLen, n)
    const parent = new Int32Array(n)
    parent.set(this.parent)
    this.parent = parent
  }

  private growAttributes(): void {
    const n = this.attrName.length * 2
    this.attrName = grow32(this.attrName, n)
    this.attrValStart = grow32(this.attrValStart, n)
    this.attrValEnd = grow32(this.attrValEnd, n)
  }
}

function grow32(a: Uint32Array, n: number): Uint32Array {
  const b = new Uint32Array(n)
  b.set(a)
  return b
}

const LT = 0x3c
const GT = 0x3e
const SLASH = 0x2f
const EQ = 0x3d
const QUOT = 0x22
const APOS = 0x27
const BANG = 0x21
const QMARK = 0x3f
const DASH = 0x2d

function isSpace(c: number | undefined): boolean {
  return c === 0x20 || c === 0x0a || c === 0x09 || c === 0x0d
}

/** Byte offset of `needle` in `bytes` at or after `from`, or -1. */
export function indexOfBytes(bytes: Uint8Array, needle: readonly number[], from: number): number {
  const first = needle[0] as number
  const n = needle.length
  let i = bytes.indexOf(first, from)
  while (i >= 0 && i + n <= bytes.length) {
    let k = 1
    while (k < n && bytes[i + k] === needle[k]) k++
    if (k === n) return i
    i = bytes.indexOf(first, i + 1)
  }
  return -1
}

const COMMENT_END = [DASH, DASH, GT]
const CDATA_START = [...'[CDATA['].map((c) => c.charCodeAt(0))
const CDATA_END = [0x5d, 0x5d, GT]
const PI_END = [QMARK, GT]

function startsWithAt(bytes: Uint8Array, at: number, seq: readonly number[]): boolean {
  for (let k = 0; k < seq.length; k++) if (bytes[at + k] !== seq[k]) return false
  return true
}

/**
 * Scan a whole XML document into an element index. One pass: text runs (including multi-megabyte
 * hex plug-in states) are skipped with `indexOf('<')`; only tags are looked at byte by byte.
 */
export function scan(bytes: Uint8Array, options: ScanOptions = {}): XmlIndex {
  const strict = options.strict ?? true
  const len = bytes.length
  const estimate = Math.max(64, len >>> 6)
  const t = new Tables(estimate, estimate)
  const names = new NameTable()
  let stackBuf = new Int32Array(1024)
  let depth = 0
  let root = -1
  let pos = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0

  while (pos < len) {
    const lt = bytes.indexOf(LT, pos)
    if (lt < 0) {
      if (strict && depth === 0) requireSpace(bytes, pos, len)
      pos = len
      break
    }
    if (strict && depth === 0 && lt > pos) requireSpace(bytes, pos, lt)
    const c = bytes[lt + 1]

    if (c === SLASH) {
      // End tag.
      let i = lt + 2
      const nameStart = i
      while (i < len && !isSpace(bytes[i]) && bytes[i] !== GT) i++
      const nameEnd = i
      while (isSpace(bytes[i])) i++
      if (bytes[i] !== GT) throw new XmlSyntaxError('expected ">" to close end tag', i)
      if (depth === 0) throw new XmlSyntaxError('end tag without start tag', lt)
      const top = stackBuf[--depth] as number
      if (strict && !names.equals(t.name[top] as number, bytes, nameStart, nameEnd)) {
        throw new XmlSyntaxError(
          `end tag does not match <${names.names[t.name[top] as number]}>`,
          lt,
        )
      }
      t.end[top] = i + 1
      t.subtreeEnd[top] = t.count
      pos = i + 1
      continue
    }

    if (c === BANG) {
      if (bytes[lt + 2] === DASH && bytes[lt + 3] === DASH) {
        const e = indexOfBytes(bytes, COMMENT_END, lt + 4)
        if (e < 0) throw new XmlSyntaxError('unterminated comment', lt)
        pos = e + 3
      } else if (startsWithAt(bytes, lt + 2, CDATA_START)) {
        if (strict && depth === 0) throw new XmlSyntaxError('CDATA outside the root element', lt)
        const e = indexOfBytes(bytes, CDATA_END, lt + 9)
        if (e < 0) throw new XmlSyntaxError('unterminated CDATA section', lt)
        pos = e + 3
      } else {
        pos = skipDeclaration(bytes, lt)
      }
      continue
    }

    if (c === QMARK) {
      const e = indexOfBytes(bytes, PI_END, lt + 2)
      if (e < 0) throw new XmlSyntaxError('unterminated processing instruction', lt)
      pos = e + 2
      continue
    }

    // Start tag.
    if (depth === 0 && root >= 0) {
      if (strict) throw new XmlSyntaxError('more than one root element', lt)
    }
    let i = lt + 1
    const nameStart = i
    let h = FNV_OFFSET
    while (i < len) {
      const ch = bytes[i] as number
      if (ch === GT || ch === SLASH || isSpace(ch)) break
      h = Math.imul(h ^ ch, FNV_PRIME)
      i++
    }
    if (i === nameStart) throw new XmlSyntaxError('missing element name', lt)
    const el = t.pushElement(
      lt,
      names.intern(h, bytes, nameStart, i),
      depth > 0 ? (stackBuf[depth - 1] as number) : -1,
    )
    if (depth === 0 && root < 0) root = el

    for (;;) {
      const before = i
      while (isSpace(bytes[i])) i++
      const ch = bytes[i]
      if (ch === GT) {
        t.openEnd[el] = i + 1
        if (depth === stackBuf.length) {
          const bigger = new Int32Array(depth * 2)
          bigger.set(stackBuf)
          stackBuf = bigger
        }
        stackBuf[depth++] = el
        pos = i + 1
        break
      }
      if (ch === SLASH) {
        if (bytes[i + 1] !== GT) throw new XmlSyntaxError('expected "/>"', i)
        t.openEnd[el] = i + 2
        t.end[el] = i + 2
        t.subtreeEnd[el] = t.count
        pos = i + 2
        break
      }
      if (i >= len) throw new XmlSyntaxError('unterminated start tag', lt)
      if (strict && i === before) throw new XmlSyntaxError('missing whitespace before attribute', i)
      const attrStart = i
      let ah = FNV_OFFSET
      while (i < len) {
        const a = bytes[i] as number
        if (a === EQ || a === GT || a === SLASH || isSpace(a)) break
        ah = Math.imul(ah ^ a, FNV_PRIME)
        i++
      }
      if (i === attrStart) throw new XmlSyntaxError('missing attribute name', i)
      const attrEnd = i
      while (isSpace(bytes[i])) i++
      if (bytes[i] !== EQ) throw new XmlSyntaxError('expected "=" after attribute name', i)
      i++
      while (isSpace(bytes[i])) i++
      const q = bytes[i]
      if (q !== QUOT && q !== APOS) throw new XmlSyntaxError('expected quoted attribute value', i)
      const valueStart = i + 1
      const valueEnd = bytes.indexOf(q, valueStart)
      if (valueEnd < 0) throw new XmlSyntaxError('unterminated attribute value', i)
      if (strict) {
        const bad = bytes.indexOf(LT, valueStart)
        if (bad >= 0 && bad < valueEnd) throw new XmlSyntaxError('"<" in attribute value', bad)
      }
      t.pushAttribute(names.intern(ah, bytes, attrStart, attrEnd), valueStart, valueEnd)
      i = valueEnd + 1
    }
    t.attrLen[el] = t.attrCount - (t.attrFirst[el] as number)
  }

  if (depth > 0) {
    const open = stackBuf[depth - 1] as number
    throw new XmlSyntaxError(
      `<${names.names[t.name[open] as number]}> is never closed`,
      t.start[open] as number,
    )
  }
  if (root < 0) throw new XmlSyntaxError('no root element', 0)
  return new XmlIndex(bytes, t, names, root)
}

function requireSpace(bytes: Uint8Array, from: number, to: number): void {
  for (let i = from; i < to; i++) {
    if (!isSpace(bytes[i])) throw new XmlSyntaxError('text outside the root element', i)
  }
}

/** Skip `<!DOCTYPE …>` (with an optional internal subset in brackets) or another declaration. */
function skipDeclaration(bytes: Uint8Array, lt: number): number {
  let i = lt + 2
  let bracket = 0
  while (i < bytes.length) {
    const c = bytes[i]
    if (c === 0x5b) bracket++
    else if (c === 0x5d) bracket--
    else if (c === GT && bracket <= 0) return i + 1
    i++
  }
  throw new XmlSyntaxError('unterminated declaration', lt)
}
