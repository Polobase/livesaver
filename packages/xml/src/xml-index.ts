import type { NameTable } from './names.js'
import type { Tables } from './scan.js'
import { decodeUtf8, decodeValue } from './text.js'

/** An element of an `XmlIndex`: its position in document order. */
export type El = number & { readonly __brand: 'El' }

/** Byte range `[start, end)` in the document. */
export interface Span {
  readonly start: number
  readonly end: number
}

const LF = 0x0a
const LT = 0x3c

/**
 * Read-only view of a scanned document. Elements are numbered in document order; every query
 * works on the original bytes, so nothing is copied or re-encoded until a value is asked for.
 */
export class XmlIndex {
  readonly bytes: Uint8Array
  readonly root: El
  private readonly t: Tables
  private readonly names: NameTable
  private readonly ids = new Map<string, number>()

  constructor(bytes: Uint8Array, tables: Tables, names: NameTable, root: number) {
    this.bytes = bytes
    this.t = tables
    this.names = names
    this.root = root as El
  }

  /** Number of elements. */
  get count(): number {
    return this.t.count
  }

  /** Name id used by the index, or -1 if no element or attribute has this name. */
  idOf(name: string): number {
    let id = this.ids.get(name)
    if (id === undefined) {
      id = this.names.lookup(name)
      this.ids.set(name, id)
    }
    return id
  }

  name(el: El): string {
    return this.names.names[this.t.name[el] as number] as string
  }

  is(el: El, name: string): boolean {
    return this.t.name[el] === this.idOf(name)
  }

  parent(el: El): El | undefined {
    const p = this.t.parent[el] as number
    return p < 0 ? undefined : (p as El)
  }

  /** Nesting depth; the root is 0. */
  depth(el: El): number {
    let d = 0
    for (let p = this.t.parent[el] as number; p >= 0; p = this.t.parent[p] as number) d++
    return d
  }

  /** Whether `el` lies inside `ancestor` (an element is not inside itself). */
  contains(ancestor: El, el: El): boolean {
    return el > ancestor && el < (this.t.subtreeEnd[ancestor] as number)
  }

  firstChild(el: El): El | undefined {
    const c = el + 1
    return c < (this.t.subtreeEnd[el] as number) ? (c as El) : undefined
  }

  nextSibling(el: El): El | undefined {
    const n = this.t.subtreeEnd[el] as number
    const p = this.t.parent[el] as number
    return p >= 0 && n < (this.t.subtreeEnd[p] as number) ? (n as El) : undefined
  }

  /** Child elements, optionally only those called `name`. */
  children(el: El, name?: string): El[] {
    const out: El[] = []
    const id = name === undefined ? -1 : this.idOf(name)
    if (name !== undefined && id < 0) return out
    const end = this.t.subtreeEnd[el] as number
    for (let c = el + 1; c < end; c = this.t.subtreeEnd[c] as number) {
      if (id < 0 || this.t.name[c] === id) out.push(c as El)
    }
    return out
  }

  /** First child called `name`. */
  child(el: El, name: string): El | undefined {
    const id = this.idOf(name)
    if (id < 0) return undefined
    const end = this.t.subtreeEnd[el] as number
    for (let c = el + 1; c < end; c = this.t.subtreeEnd[c] as number) {
      if (this.t.name[c] === id) return c as El
    }
    return undefined
  }

  /** All elements inside `el` in document order, optionally only those called `name`. */
  descendants(el: El, name?: string): El[] {
    const out: El[] = []
    const id = name === undefined ? -1 : this.idOf(name)
    if (name !== undefined && id < 0) return out
    const end = this.t.subtreeEnd[el] as number
    for (let c = el + 1; c < end; c++) {
      if (id < 0 || this.t.name[c] === id) out.push(c as El)
    }
    return out
  }

  /** First element called `name` inside `el`, in document order. */
  firstDescendant(el: El, name: string): El | undefined {
    const id = this.idOf(name)
    if (id < 0) return undefined
    const end = this.t.subtreeEnd[el] as number
    for (let c = el + 1; c < end; c++) if (this.t.name[c] === id) return c as El
    return undefined
  }

  /** Every element in the document called `name`, in document order. */
  all(name: string): El[] {
    const out: El[] = []
    const id = this.idOf(name)
    if (id < 0) return out
    const names = this.t.name
    for (let i = 0; i < this.t.count; i++) if (names[i] === id) out.push(i as El)
    return out
  }

  /** Follow child steps: `find(el, 'FileRef/RelativePath')`. */
  find(el: El, path: string): El | undefined {
    let current: El | undefined = el
    for (const step of path.split('/')) {
      if (current === undefined) return undefined
      if (step === '') continue
      current = this.child(current, step)
    }
    return current
  }

  /** Every element reached by the child steps of `path`. */
  findAll(el: El, path: string): El[] {
    let current: El[] = [el]
    for (const step of path.split('/')) {
      if (step === '') continue
      current = current.flatMap((c) => this.children(c, step))
    }
    return current
  }

  attrCount(el: El): number {
    return this.t.attrLen[el] as number
  }

  attrNames(el: El): string[] {
    const first = this.t.attrFirst[el] as number
    const n = this.t.attrLen[el] as number
    const out: string[] = []
    for (let a = first; a < first + n; a++)
      out.push(this.names.names[this.t.attrName[a] as number] as string)
    return out
  }

  private attrIndex(el: El, name: string): number {
    const id = this.idOf(name)
    if (id < 0) return -1
    const first = this.t.attrFirst[el] as number
    const n = this.t.attrLen[el] as number
    for (let a = first; a < first + n; a++) if (this.t.attrName[a] === id) return a
    return -1
  }

  /** Attribute value with entity references resolved. */
  attr(el: El, name: string): string | undefined {
    const a = this.attrIndex(el, name)
    if (a < 0) return undefined
    return decodeValue(this.bytes, this.t.attrValStart[a] as number, this.t.attrValEnd[a] as number)
  }

  /** Attribute value exactly as written (entity references not resolved). */
  attrRaw(el: El, name: string): string | undefined {
    const a = this.attrIndex(el, name)
    if (a < 0) return undefined
    return decodeUtf8(this.bytes, this.t.attrValStart[a] as number, this.t.attrValEnd[a] as number)
  }

  /** Byte range of an attribute's value, without the quotes. */
  attrSpan(el: El, name: string): Span | undefined {
    const a = this.attrIndex(el, name)
    if (a < 0) return undefined
    return { start: this.t.attrValStart[a] as number, end: this.t.attrValEnd[a] as number }
  }

  /** The quote character around an attribute's value. */
  attrQuote(el: El, name: string): '"' | "'" | undefined {
    const span = this.attrSpan(el, name)
    if (!span) return undefined
    return this.bytes[span.start - 1] === 0x27 ? "'" : '"'
  }

  /** The `Value` attribute of `el`, or of the element at `path` below it. */
  value(el: El, path?: string): string | undefined {
    const target = path === undefined ? el : this.find(el, path)
    return target === undefined ? undefined : this.attr(target, 'Value')
  }

  /** The whole element, from `<` of its start tag to `>` of its end tag. */
  span(el: El): Span {
    return { start: this.t.start[el] as number, end: this.t.end[el] as number }
  }

  /** The start tag. */
  openTag(el: El): Span {
    return { start: this.t.start[el] as number, end: this.t.openEnd[el] as number }
  }

  isSelfClosing(el: El): boolean {
    return this.t.openEnd[el] === this.t.end[el]
  }

  /** Everything between the start tag and the end tag (empty for `<X />`). */
  inner(el: El): Span {
    const open = this.t.openEnd[el] as number
    if (this.isSelfClosing(el)) return { start: open, end: open }
    return { start: open, end: this.bytes.lastIndexOf(LT, (this.t.end[el] as number) - 1) }
  }

  /** Decoded content of a text-only element. */
  text(el: El): string {
    const { start, end } = this.inner(el)
    return decodeValue(this.bytes, start, end)
  }

  /** Offset of the first byte of the line the element starts on. */
  lineStart(el: El): number {
    return this.bytes.lastIndexOf(LF, (this.t.start[el] as number) - 1) + 1
  }

  /** Whitespace before the element on its line ('' if other content precedes it). */
  indent(el: El): string {
    const from = this.lineStart(el)
    const to = this.t.start[el] as number
    for (let i = from; i < to; i++) {
      const c = this.bytes[i]
      if (c !== 0x20 && c !== 0x09) return ''
    }
    return decodeUtf8(this.bytes, from, to)
  }

  /** Decoded bytes of any range. */
  slice(span: Span): string {
    return decodeUtf8(this.bytes, span.start, span.end)
  }
}
