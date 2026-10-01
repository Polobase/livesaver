/**
 * Property lists (Apple's `.plist`): the XML and binary formats read, the binary format written.
 * Needed for bundle `Info.plist` files (plug-in inventory) and Finder metadata (tags, comments).
 * Reading follows Python's `plistlib.loads`; writing produces the same bytes as
 * `plistlib.dumps(value, fmt=FMT_BINARY)` (and Finder's own writer for the values Finder uses).
 */
import { decodeEntities } from '@livesaver/xml'

export type PlistValue =
  | string
  | number
  | bigint
  | boolean
  | Date
  | Uint8Array
  | null
  | PlistValue[]
  | PlistDict

export interface PlistDict {
  [key: string]: PlistValue
}

/** Not a property list, or a damaged one. */
export class PlistError extends Error {
  override name = 'PlistError'
}

const BPLIST = [0x62, 0x70, 0x6c, 0x69, 0x73, 0x74] // "bplist"

function startsWith(data: Uint8Array, prefix: readonly number[], at = 0): boolean {
  return prefix.every((b, i) => data[at + i] === b)
}

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0))
const XML_PREFIXES = [ascii('<?xml'), ascii('<plist')]
const UTF8_BOM = [0xef, 0xbb, 0xbf]

/** Whether `data` starts like a property list plistlib would accept. */
export function isPlist(data: Uint8Array): boolean {
  if (startsWith(data, [...BPLIST, 0x30, 0x30])) return true
  const at = startsWith(data, UTF8_BOM) ? 3 : 0
  return XML_PREFIXES.some((p) => startsWith(data, p, at))
}

/** Parse a binary or XML property list; throws `PlistError`. */
export function parsePlist(data: Uint8Array): PlistValue {
  if (startsWith(data, [...BPLIST, 0x30, 0x30])) return parseBinary(data)
  if (!isPlist(data)) throw new PlistError('not a property list')
  const at = startsWith(data, UTF8_BOM) ? 3 : 0
  return parseXml(new TextDecoder().decode(data.subarray(at)))
}

// ------------------------------------------------------------------------------------ binary

function parseBinary(data: Uint8Array): PlistValue {
  if (data.length < 8 + 32) throw new PlistError('binary plist too short')
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const t = data.length - 32
  const offsetSize = data[t + 6] as number
  const refSize = data[t + 7] as number
  const count = safe(view.getBigUint64(t + 8))
  const top = safe(view.getBigUint64(t + 16))
  const tableOffset = safe(view.getBigUint64(t + 24))
  const uint = (pos: number, size: number): number => {
    if (pos + size > data.length) throw new PlistError('binary plist truncated')
    let n = 0
    for (let i = 0; i < size; i++) n = n * 256 + (data[pos + i] as number)
    return n
  }
  const offsets: number[] = []
  for (let i = 0; i < count; i++) offsets.push(uint(tableOffset + i * offsetSize, offsetSize))
  const reading = new Set<number>()

  const read = (ref: number): PlistValue => {
    const start = offsets[ref]
    if (start === undefined || start >= data.length) throw new PlistError('bad object reference')
    if (reading.has(ref)) throw new PlistError('cyclic plist')
    reading.add(ref)
    try {
      return readObject(start)
    } finally {
      reading.delete(ref)
    }
  }
  const sizeAt = (low: number, pos: number): [size: number, next: number] => {
    if (low !== 0xf) return [low, pos]
    const marker = data[pos]
    if (marker === undefined || marker >> 4 !== 0x1) throw new PlistError('bad length')
    const bytes = 1 << (marker & 0x3)
    return [uint(pos + 1, bytes), pos + 1 + bytes]
  }
  const bytesAt = (pos: number, length: number): Uint8Array => {
    if (pos + length > data.length) throw new PlistError('binary plist truncated')
    return data.subarray(pos, pos + length)
  }
  const readObject = (pos: number): PlistValue => {
    const token = data[pos] as number
    const high = token & 0xf0
    const low = token & 0x0f
    if (token === 0x00) return null
    if (token === 0x08) return false
    if (token === 0x09) return true
    if (token === 0x0f) return new Uint8Array(0)
    if (high === 0x10) {
      const size = 1 << low
      const raw = bytesAt(pos + 1, size)
      let n = 0n
      for (const b of raw) n = (n << 8n) | BigInt(b)
      if (low >= 3 && raw[0] !== undefined && raw[0] >= 0x80) n -= 1n << BigInt(size * 8)
      return n >= BigInt(Number.MIN_SAFE_INTEGER) && n <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(n)
        : n
    }
    if (token === 0x22) return view.getFloat32(pos + 1)
    if (token === 0x23) return view.getFloat64(pos + 1)
    if (token === 0x33) return new Date(Date.UTC(2001, 0, 1) + view.getFloat64(pos + 1) * 1000)
    if (high === 0x40) {
      const [size, at] = sizeAt(low, pos + 1)
      return bytesAt(at, size).slice()
    }
    if (high === 0x50) {
      const [size, at] = sizeAt(low, pos + 1)
      const raw = bytesAt(at, size)
      if (raw.some((b) => b > 0x7f)) throw new PlistError('non-ASCII byte in ASCII string')
      return String.fromCharCode(...raw)
    }
    if (high === 0x60) {
      const [size, at] = sizeAt(low, pos + 1)
      const raw = bytesAt(at, size * 2)
      let out = ''
      for (let i = 0; i < raw.length; i += 2)
        out += String.fromCharCode(((raw[i] as number) << 8) | (raw[i + 1] as number))
      return out
    }
    if (high === 0x80) return uint(pos + 1, low + 1)
    if (high === 0xa0) {
      const [size, at] = sizeAt(low, pos + 1)
      const out: PlistValue[] = []
      for (let i = 0; i < size; i++) out.push(read(uint(at + i * refSize, refSize)))
      return out
    }
    if (high === 0xd0) {
      const [size, at] = sizeAt(low, pos + 1)
      const out: PlistDict = Object.create(null)
      for (let i = 0; i < size; i++) {
        const key = read(uint(at + i * refSize, refSize))
        if (typeof key !== 'string') throw new PlistError('dictionary key is not a string')
        out[key] = read(uint(at + (size + i) * refSize, refSize))
      }
      return out
    }
    throw new PlistError(`unknown plist object 0x${token.toString(16)}`)
  }
  return read(top)
}

function safe(n: bigint): number {
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new PlistError('binary plist too large')
  return Number(n)
}

/** Binary plist of `value`, byte for byte like `plistlib.dumps(value, fmt=plistlib.FMT_BINARY)`. */
export function encodeBinaryPlist(value: PlistValue): Uint8Array {
  // Flatten: containers are always new objects, equal scalars are shared (plistlib's _flatten).
  const objects: PlistValue[] = []
  const scalars = new Map<string, number>()
  const containers = new Map<object, number>()
  const scalarKey = (v: PlistValue): string | undefined => {
    if (typeof v === 'string') return `s${v}`
    if (typeof v === 'boolean') return `b${v}`
    if (typeof v === 'number') return Number.isInteger(v) ? `i${v}` : `f${v}`
    if (typeof v === 'bigint') return `i${v}`
    if (v === null) return 'n'
    if (v instanceof Uint8Array)
      return `d${Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('')}`
    if (v instanceof Date) return `t${v.getTime()}`
    return undefined
  }
  const flatten = (v: PlistValue): void => {
    const key = scalarKey(v)
    if (key !== undefined) {
      if (scalars.has(key)) return
      scalars.set(key, objects.length)
    } else {
      if (containers.has(v as object)) return
      containers.set(v as object, objects.length)
    }
    objects.push(v)
    if (Array.isArray(v)) for (const item of v) flatten(item)
    else if (isDict(v)) {
      const keys = Object.keys(v).sort(compareKeys)
      for (const k of keys) flatten(k)
      for (const k of keys) flatten(v[k] as PlistValue)
    }
  }
  flatten(value)
  const refOf = (v: PlistValue): number => {
    const key = scalarKey(v)
    return (key !== undefined ? scalars.get(key) : containers.get(v as object)) as number
  }
  const refSize = countToSize(objects.length)
  const out: number[] = [...BPLIST, 0x30, 0x30]
  const offsets: number[] = []
  const pushUint = (n: number | bigint, size: number) => {
    let x = BigInt(n)
    const bytes: number[] = []
    for (let i = 0; i < size; i++) {
      bytes.unshift(Number(x & 0xffn))
      x >>= 8n
    }
    out.push(...bytes)
  }
  const writeSize = (token: number, size: number) => {
    if (size < 15) out.push(token | size)
    else if (size < 1 << 8) out.push(token | 0xf, 0x10, size)
    else if (size < 1 << 16) {
      out.push(token | 0xf, 0x11)
      pushUint(size, 2)
    } else {
      out.push(token | 0xf, 0x12)
      pushUint(size, 4)
    }
  }
  for (const v of objects) {
    offsets.push(out.length)
    if (v === null) out.push(0x00)
    else if (v === false) out.push(0x08)
    else if (v === true) out.push(0x09)
    else if (typeof v === 'number' || typeof v === 'bigint') {
      if (typeof v === 'number' && !Number.isInteger(v)) {
        out.push(0x23)
        const b = new DataView(new ArrayBuffer(8))
        b.setFloat64(0, v)
        out.push(...new Uint8Array(b.buffer))
        continue
      }
      const n = BigInt(v)
      if (n < 0n) {
        out.push(0x13)
        pushUint(BigInt.asUintN(64, n), 8)
      } else if (n < 1n << 8n) out.push(0x10, Number(n))
      else if (n < 1n << 16n) {
        out.push(0x11)
        pushUint(n, 2)
      } else if (n < 1n << 32n) {
        out.push(0x12)
        pushUint(n, 4)
      } else if (n < 1n << 63n) {
        out.push(0x13)
        pushUint(n, 8)
      } else {
        out.push(0x14)
        pushUint(n, 16)
      }
    } else if (typeof v === 'string') {
      let isAscii = true
      for (let i = 0; i < v.length; i++) if (v.charCodeAt(i) > 0x7f) isAscii = false
      if (isAscii) {
        writeSize(0x50, v.length)
        for (let i = 0; i < v.length; i++) out.push(v.charCodeAt(i))
      } else {
        writeSize(0x60, v.length)
        for (let i = 0; i < v.length; i++) {
          const c = v.charCodeAt(i)
          out.push(c >> 8, c & 0xff)
        }
      }
    } else if (v instanceof Uint8Array) {
      writeSize(0x40, v.length)
      out.push(...v)
    } else if (v instanceof Date) {
      out.push(0x33)
      const b = new DataView(new ArrayBuffer(8))
      b.setFloat64(0, (v.getTime() - Date.UTC(2001, 0, 1)) / 1000)
      out.push(...new Uint8Array(b.buffer))
    } else if (Array.isArray(v)) {
      writeSize(0xa0, v.length)
      for (const item of v) pushUint(refOf(item), refSize)
    } else {
      const keys = Object.keys(v).sort(compareKeys)
      writeSize(0xd0, keys.length)
      for (const k of keys) pushUint(refOf(k), refSize)
      for (const k of keys) pushUint(refOf(v[k] as PlistValue), refSize)
    }
  }
  const tableOffset = out.length
  const offsetSize = countToSize(tableOffset)
  for (const o of offsets) pushUint(o, offsetSize)
  out.push(0, 0, 0, 0, 0, 0, offsetSize, refSize)
  pushUint(objects.length, 8)
  pushUint(refOf(value), 8)
  pushUint(tableOffset, 8)
  return Uint8Array.from(out)
}

function countToSize(count: number): number {
  if (count < 1 << 8) return 1
  if (count < 1 << 16) return 2
  if (count < 2 ** 32) return 4
  return 8
}

function isDict(v: PlistValue): v is PlistDict {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    !(v instanceof Uint8Array) &&
    !(v instanceof Date)
  )
}

/** Python sorts dictionary keys by code point. */
function compareKeys(a: string, b: string): number {
  if (a === b) return 0
  const x = [...a]
  const y = [...b]
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const cx = (x[i] as string).codePointAt(0) as number
    const cy = (y[i] as string).codePointAt(0) as number
    if (cx !== cy) return cx - cy
  }
  return x.length - y.length
}

// ------------------------------------------------------------------------------------ XML

const XML_TOKEN =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w.:-]*)(?:\s[^>]*?)?(\/?)>|([^<]+)/g

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '')
  const out: number[] = []
  let bits = 0
  let acc = 0
  for (const c of clean) {
    acc = (acc << 6) | BASE64.indexOf(c)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((acc >> bits) & 0xff)
    }
  }
  return Uint8Array.from(out)
}

/** plistlib's XML reader: `<dict>`, `<array>`, `<key>`, `<string>`, `<integer>`, `<real>`, … */
function parseXml(text: string): PlistValue {
  const stack: (PlistValue[] | PlistDict)[] = []
  let key: string | undefined
  let data = ''
  let root: PlistValue | undefined
  let hasRoot = false
  const add = (value: PlistValue) => {
    const top = stack.at(-1)
    if (key !== undefined) {
      if (!top || Array.isArray(top)) throw new PlistError('key outside a dictionary')
      top[key] = value
      key = undefined
    } else if (!top) {
      root = value
      hasRoot = true
    } else {
      if (!Array.isArray(top)) throw new PlistError('value without a key in a dictionary')
      top.push(value)
    }
  }
  for (const m of text.matchAll(XML_TOKEN)) {
    const [whole, cdata, close, name, selfClosing, chars] = m
    if (chars !== undefined) {
      data += decodeEntities(chars)
      continue
    }
    if (cdata !== undefined) {
      data += cdata
      continue
    }
    if (name === undefined || whole.startsWith('<!') || whole.startsWith('<?')) continue
    const opening = !close
    const closing = Boolean(close) || Boolean(selfClosing)
    if (opening) {
      data = ''
      if (name === 'dict') {
        const d: PlistDict = Object.create(null)
        add(d)
        stack.push(d)
      } else if (name === 'array') {
        const a: PlistValue[] = []
        add(a)
        stack.push(a)
      }
    }
    if (!closing) continue
    const content = data
    data = ''
    switch (name) {
      case 'dict':
      case 'array':
        if (key !== undefined) throw new PlistError('missing value for key')
        stack.pop()
        break
      case 'key': {
        const top = stack.at(-1)
        if (key !== undefined || !top || Array.isArray(top)) throw new PlistError('unexpected key')
        key = content
        break
      }
      case 'string':
        add(content)
        break
      case 'integer': {
        const raw = content.trim()
        if (!/^(?:[+-]?\d+|0[xX][0-9a-fA-F]+)$/.test(raw))
          throw new PlistError(`bad integer ${raw}`)
        const n = BigInt(raw.replace(/^\+/, '').replace(/^0X/, '0x'))
        add(
          n >= BigInt(Number.MIN_SAFE_INTEGER) && n <= BigInt(Number.MAX_SAFE_INTEGER)
            ? Number(n)
            : n,
        )
        break
      }
      case 'real':
        add(Number(content.trim()))
        break
      case 'true':
        add(true)
        break
      case 'false':
        add(false)
        break
      case 'data':
        add(decodeBase64(content))
        break
      case 'date':
        add(new Date(content.trim()))
        break
      default:
        break
    }
  }
  if (!hasRoot) throw new PlistError('empty property list')
  return root as PlistValue
}
