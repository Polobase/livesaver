import { type ScanOptions, scan } from './scan.js'
import { encodeUtf8, type Quoting, quoteAttr } from './text.js'
import type { El, XmlIndex } from './xml-index.js'

/** One replacement of the byte range `[start, end)` (an insertion when `start === end`). */
export interface Edit {
  readonly start: number
  readonly end: number
  readonly text: string
}

/** Two edits touch the same bytes. */
export class PatchConflictError extends Error {
  constructor(a: Edit, b: Edit) {
    super(`overlapping edits [${a.start}, ${a.end}) and [${b.start}, ${b.end})`)
    this.name = 'PatchConflictError'
  }
}

export interface PatchOptions {
  /** How `setAttr` quotes values (default `double`: always double quotes). */
  readonly quoting?: Quoting
}

interface PendingEdit extends Edit {
  readonly seq: number
}

/**
 * Collects edits against a scanned document and splices them into a new buffer. Bytes outside the
 * edited ranges are copied unchanged, so a Live Set keeps every byte nobody meant to touch.
 */
export class Patch {
  readonly bytes: Uint8Array
  readonly quoting: Quoting
  private readonly source: XmlIndex | undefined
  private readonly pending: PendingEdit[] = []

  /** Edits against a scanned document, or against raw bytes (then only `replaceRange` is available). */
  constructor(source: XmlIndex | Uint8Array, options: PatchOptions = {}) {
    this.source = source instanceof Uint8Array ? undefined : source
    this.bytes = source instanceof Uint8Array ? source : source.bytes
    this.quoting = options.quoting ?? 'double'
  }

  /** The element index; only available when the patch was made from one. */
  get index(): XmlIndex {
    if (!this.source)
      throw new Error('this patch was made from raw bytes; element edits need an XmlIndex')
    return this.source
  }

  get size(): number {
    return this.pending.length
  }

  replaceRange(start: number, end: number, text: string): this {
    if (start < 0 || end < start || end > this.bytes.length) {
      throw new RangeError(`invalid edit range [${start}, ${end})`)
    }
    this.pending.push({ start, end, text, seq: this.pending.length })
    return this
  }

  /** Set an existing attribute's value (the quotes are rewritten according to `quoting`). */
  setAttr(el: El, name: string, value: string): this {
    const span = this.index.attrSpan(el, name)
    if (!span) throw new Error(`<${this.index.name(el)}> has no attribute ${name}`)
    return this.replaceRange(span.start - 1, span.end + 1, quoteAttr(value, this.quoting))
  }

  /** Replace the whole element with `xml`. */
  replace(el: El, xml: string): this {
    const { start, end } = this.index.span(el)
    return this.replaceRange(start, end, xml)
  }

  /** Replace everything between the start and end tag. */
  replaceInner(el: El, text: string): this {
    if (this.index.isSelfClosing(el))
      throw new Error(`<${this.index.name(el)} /> has no content to replace`)
    const { start, end } = this.index.inner(el)
    return this.replaceRange(start, end, text)
  }

  insertBefore(el: El, xml: string): this {
    const { start } = this.index.span(el)
    return this.replaceRange(start, start, xml)
  }

  insertAfter(el: El, xml: string): this {
    const { end } = this.index.span(el)
    return this.replaceRange(end, end, xml)
  }

  /** Remove the element; if it has a line of its own, the whole line goes with it. */
  remove(el: El): this {
    const bytes = this.bytes
    const { start, end } = this.index.span(el)
    const lineStart = this.index.lineStart(el)
    const aloneBefore = lineStart === start || this.index.indent(el) !== ''
    let after = end
    while (bytes[after] === 0x20 || bytes[after] === 0x09) after++
    if (aloneBefore) {
      if (bytes[after] === 0x0a) return this.replaceRange(lineStart, after + 1, '')
      if (bytes[after] === 0x0d && bytes[after + 1] === 0x0a)
        return this.replaceRange(lineStart, after + 2, '')
      if (after >= bytes.length) return this.replaceRange(lineStart, after, '')
    }
    return this.replaceRange(start, end, '')
  }

  /** The edits in the order they are applied. */
  edits(): Edit[] {
    return this.sorted().map(({ start, end, text }) => ({ start, end, text }))
  }

  private sorted(): PendingEdit[] {
    return [...this.pending].sort((a, b) => a.start - b.start || a.end - b.end || a.seq - b.seq)
  }

  /** The patched document. Throws `PatchConflictError` if two edits overlap. */
  apply(): Uint8Array {
    const bytes = this.bytes
    const parts: Uint8Array[] = []
    let pos = 0
    let previous: PendingEdit | undefined
    for (const edit of this.sorted()) {
      if (edit.start < pos && previous) throw new PatchConflictError(previous, edit)
      if (edit.start > pos) parts.push(bytes.subarray(pos, edit.start))
      if (edit.text) parts.push(encodeUtf8(edit.text))
      pos = edit.end
      previous = edit
    }
    if (pos < bytes.length) parts.push(bytes.subarray(pos))
    let total = 0
    for (const p of parts) total += p.length
    const out = new Uint8Array(total)
    let offset = 0
    for (const p of parts) {
      out.set(p, offset)
      offset += p.length
    }
    return out
  }

  /** Apply and re-scan the result strictly, so a malformed edit can never reach the disk. */
  applyChecked(options: ScanOptions = {}): { bytes: Uint8Array; index: XmlIndex } {
    const bytes = this.apply()
    return { bytes, index: scan(bytes, { strict: true, ...options }) }
  }
}

export function patch(source: XmlIndex | Uint8Array, options: PatchOptions = {}): Patch {
  return new Patch(source, options)
}
