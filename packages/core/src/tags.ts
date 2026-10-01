/**
 * Finder tags and comments as stored in extended attributes (the parts that need no Finder).
 *
 * Tags live in `com.apple.metadata:_kMDItemUserTags`: a binary property list with one string per
 * tag, `"Name\n<colour>"` (0 none, 1 grey, 2 green, 3 purple, 4 blue, 5 yellow, 6 red, 7 orange).
 * Finder mirrors a file's comment into `com.apple.metadata:kMDItemFinderComment`; the comment Finder
 * shows lives in the parent folder's `.DS_Store` and can only be set through Finder itself.
 */
import { compareCodePoints, nfc } from './compat.js'
import { encodeBinaryPlist, isPlist, type PlistValue, parsePlist } from './plist.js'

export const TAGS_ATTR = 'com.apple.metadata:_kMDItemUserTags'
export const COMMENT_ATTR = 'com.apple.metadata:kMDItemFinderComment'

/** Finder's tag colours. */
export const TAG_COLOURS = {
  none: 0,
  grey: 1,
  green: 2,
  purple: 3,
  blue: 4,
  yellow: 5,
  red: 6,
  orange: 7,
} as const

/** A Finder tag: name and colour. */
export type Tag = readonly [name: string, colour: number]

function pyStr(item: PlistValue): string {
  if (typeof item === 'string') return item
  if (typeof item === 'boolean') return item ? 'True' : 'False'
  if (typeof item === 'number' || typeof item === 'bigint') return String(item)
  return ''
}

/** Tags of an attribute value (none if absent or unreadable); names in NFC. */
export function decodeTags(raw: Uint8Array | undefined): Tag[] {
  if (!raw || raw.length === 0) return []
  let items: PlistValue
  try {
    items = parsePlist(raw)
  } catch {
    return []
  }
  if (!Array.isArray(items)) return []
  return items.map((item) => {
    const text = pyStr(item)
    const cut = text.indexOf('\n')
    const name = cut < 0 ? text : text.slice(0, cut)
    const colour = cut < 0 ? '' : text.slice(cut + 1)
    return [nfc(name), /^[0-9]+$/.test(colour) ? Number(colour) : 0] as const
  })
}

/** The attribute value for `tags`: a binary property list of `"Name\n<colour>"` strings. */
export function encodeTags(tags: readonly Tag[]): Uint8Array {
  return encodeBinaryPlist(tags.map(([name, colour]) => `${name}\n${colour}`))
}

/** The comment mirrored into the attribute ('' if none); text that is no plist is taken as is. */
export function decodeComment(raw: Uint8Array | undefined): string {
  if (!raw || raw.length === 0) return ''
  if (!isPlist(raw)) return new TextDecoder().decode(raw)
  try {
    const value = parsePlist(raw)
    return typeof value === 'string' ? nfc(value) : ''
  } catch {
    // A damaged binary plist is taken as text; a damaged XML one is no comment.
    return raw[0] === 0x62 ? new TextDecoder().decode(raw) : ''
  }
}

/** Tags after replacing the `managed` ones by `wanted`; all other tags stay as they are. */
export function mergedTags(
  current: readonly Tag[],
  managed: ReadonlySet<string>,
  wanted: readonly Tag[],
): Tag[] {
  return [...current.filter(([name]) => !managed.has(name)), ...wanted]
}

function compareTags(a: Tag, b: Tag): number {
  return compareCodePoints(a[0], b[0]) || a[1] - b[1]
}

/** Same tags regardless of order. */
export function sameTags(a: readonly Tag[], b: readonly Tag[]): boolean {
  if (a.length !== b.length) return false
  const x = [...a].sort(compareTags)
  const y = [...b].sort(compareTags)
  return x.every((t, i) => compareTags(t, y[i] as Tag) === 0)
}
