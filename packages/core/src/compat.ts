/**
 * String and number helpers with exact, well-defined semantics: Unicode full case folding, Python's
 * strip/int()/float() rules, code-point ordering and Python-style number formatting. JavaScript's
 * look-alikes (toLowerCase, trim, Number, `<`, toFixed) differ in corner cases, and names compared
 * or numbers written differently would change matching decisions and report bytes.
 */
import { CASEFOLD_TABLE } from './casefold.generated.js'

let folding: Map<number, string> | undefined

function foldMap(): Map<number, string> {
  if (!folding) {
    folding = new Map()
    for (const entry of CASEFOLD_TABLE.split(';')) {
      const colon = entry.indexOf(':')
      const cp = Number.parseInt(entry.slice(0, colon), 16)
      const folded = entry
        .slice(colon + 1)
        .split(' ')
        .map((h) => String.fromCodePoint(Number.parseInt(h, 16)))
        .join('')
      folding.set(cp, folded)
    }
  }
  return folding
}

/** Python's `str.casefold()` (Unicode full case folding): `'ﬁNAL'` → `'final'`. */
export function casefold(text: string): string {
  let ascii = true
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) {
      ascii = false
      break
    }
  }
  if (ascii) return text.toLowerCase()
  const map = foldMap()
  let out = ''
  for (const ch of text) {
    const folded = map.get(ch.codePointAt(0) as number)
    out += folded ?? ch
  }
  return out
}

/** Characters Python's `str.strip()` removes (`str.isspace()`); differs from JS `trim()`. */
function isPySpace(cp: number): boolean {
  return (
    (cp >= 0x09 && cp <= 0x0d) ||
    (cp >= 0x1c && cp <= 0x20) ||
    cp === 0x85 ||
    cp === 0xa0 ||
    cp === 0x1680 ||
    (cp >= 0x2000 && cp <= 0x200a) ||
    cp === 0x2028 ||
    cp === 0x2029 ||
    cp === 0x202f ||
    cp === 0x205f ||
    cp === 0x3000
  )
}

/** Python's `str.strip()` without arguments. */
export function pyStrip(text: string): string {
  let start = 0
  let end = text.length
  while (start < end && isPySpace(text.charCodeAt(start))) start++
  while (end > start && isPySpace(text.charCodeAt(end - 1))) end--
  return text.slice(start, end)
}

/** Python's `int(value)` for decimal strings; anything invalid is 0 (a missing size or CRC). */
export function pyInt(value: string): number {
  const s = pyStrip(value)
  if (!/^[+-]?\d+(?:_\d+)*$/.test(s)) return 0
  return Number(s.replaceAll('_', ''))
}

/** Unicode NFC. */
export function nfc(text: string): string {
  return text.normalize('NFC')
}

/**
 * The comparison key for names and paths: macOS file names are case- and
 * normalization-insensitive; `:` folds into `_` (Windows "CLAP_SNARE" vs Mac "CLAP:SNARE");
 * surrounding whitespace is ignored ("  SP_Kick_1.wav").
 */
export function norm(text: string): string {
  return pyStrip(casefold(nfc(text)).replaceAll(':', '_'))
}

/** Length in code points, like Python's `len(str)`. */
export function codePointLength(text: string): number {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) i++
    }
    n++
  }
  return n
}

/** Compare by code points, like Python's string ordering (JS `<` compares UTF-16 units). */
export function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0
  const ia = a[Symbol.iterator]()
  const ib = b[Symbol.iterator]()
  for (;;) {
    const x = ia.next()
    const y = ib.next()
    if (x.done) return y.done ? 0 : -1
    if (y.done) return 1
    const cx = (x.value as string).codePointAt(0) as number
    const cy = (y.value as string).codePointAt(0) as number
    if (cx !== cy) return cx < cy ? -1 : 1
  }
}

const FLOAT_RE =
  /^[+-]?(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?$/

/** Python's `float(text)`: throws like Python on anything it would reject. */
export function pyFloat(text: string): number {
  const t = pyStrip(text)
  if (/^[+-]?(?:inf|infinity)$/i.test(t))
    return t.startsWith('-') ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY
  if (/^[+-]?nan$/i.test(t)) return Number.NaN
  if (!FLOAT_RE.test(t)) throw new Error(`could not convert string to float: '${text}'`)
  return Number(t.replaceAll('_', ''))
}

/**
 * Python's `f"{x:.{digits}f}"`. Differs from `toFixed` on exact ties (Python rounds half to even on the
 * exact binary value: 0.0078125 → "0.007812", 120.0625 → "120.062"), on -0, infinities, NaN and ≥ 1e21.
 */
export function pyFixed(x: number, digits: number): string {
  if (Number.isNaN(x)) return 'nan'
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf'
  const sign = x < 0 || Object.is(x, -0) ? '-' : ''
  const a = Math.abs(x)
  if (a >= 1e21)
    return `${sign}${BigInt(a).toString()}${digits > 0 ? `.${'0'.repeat(digits)}` : ''}`
  const rounded = a.toFixed(digits)
  if (a < 0.5 * 10 ** -digits) return sign + rounded
  const exact = a.toFixed(100) // the exact decimal expansion in this range
  const [intPart = '', frac = ''] = exact.split('.')
  const rest = frac.slice(digits)
  if (rest[0] !== '5' || !/^0*$/.test(rest.slice(1))) return sign + rounded
  const last = digits > 0 ? frac[digits - 1] : intPart.at(-1)
  const even = Number(last) % 2 === 0
  return sign + (even ? intPart + (digits > 0 ? `.${frac.slice(0, digits)}` : '') : rounded)
}

/** Python's `round(x)`: to the nearest integer, exact halves to the even one (`round(2.5)` → 2). */
export function pyRound(x: number): number {
  if (!Number.isFinite(x)) throw new Error(`cannot convert float ${x} to integer`)
  const floor = Math.floor(x)
  const diff = x - floor // exact for doubles
  if (diff > 0.5) return floor + 1
  if (diff < 0.5) return floor
  return floor % 2 === 0 ? floor : floor + 1
}

/** Python's `round(x, digits)` for floats: correctly rounded, exact ties to even. */
export function pyRoundTo(x: number, digits: number): number {
  if (!Number.isFinite(x)) return x
  return Number(pyFixed(x, digits))
}

/**
 * Python's `format(x, 'g')` (`f"{x:g}"`): 6 significant digits, exact ties to even, trailing zeros
 * removed, exponent notation below 1e-4 and from 1e6 on (`1.5e+06`).
 */
export function pyG(x: number, precision = 6): string {
  if (Number.isNaN(x)) return 'nan'
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf'
  if (x === 0) return Object.is(x, -0) ? '-0' : '0'
  const sign = x < 0 ? '-' : ''
  const a = Math.abs(x)
  let digits: string
  let exp: number
  if (a >= 1e-7 && a < 1e21) {
    // Exact decimal expansion, then round to `precision` significant digits.
    const [intPart = '', frac = ''] = a.toFixed(100).split('.')
    let sig: string
    if (intPart === '0') {
      const lead = frac.search(/[1-9]/)
      exp = -(lead + 1)
      sig = frac.slice(lead)
    } else {
      exp = intPart.length - 1
      sig = intPart + frac
    }
    let kept = sig.slice(0, precision)
    const rest = sig.slice(precision)
    const up =
      rest[0] !== undefined &&
      (rest[0] > '5' ||
        (rest[0] === '5' &&
          (/[1-9]/.test(rest.slice(1)) || Number(kept[kept.length - 1]) % 2 === 1)))
    if (up) {
      const n = (BigInt(kept) + 1n).toString()
      if (n.length > precision) {
        exp += 1
        kept = n.slice(0, precision)
      } else kept = n.padStart(precision, '0')
    }
    digits = kept
  } else {
    const [mant = '', e = '0'] = a.toExponential(precision - 1).split('e')
    digits = mant.replace('.', '')
    exp = Number(e)
  }
  const strip = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s)
  if (exp >= -4 && exp < precision) {
    const point = exp + 1
    const text =
      point <= 0
        ? `0.${'0'.repeat(-point)}${digits}`
        : `${digits.slice(0, point)}.${digits.slice(point)}`
    return sign + strip(text)
  }
  const mantissa = strip(`${digits[0]}.${digits.slice(1)}`)
  return `${sign}${mantissa}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`
}

/** Python's `a // b` (floor division). */
export function pyFloorDiv(a: number, b: number): number {
  return Math.floor(a / b)
}

/** Python's `a % b` (result has the sign of `b`). */
export function pyMod(a: number, b: number): number {
  return ((a % b) + b) % b
}
