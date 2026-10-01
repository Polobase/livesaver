/**
 * Plug-in identity. VST2 plug-ins are identified by a 32-bit unique id (usually four characters,
 * e.g. 'XfsX'), VST3 classes by a 16-byte class id, which Live stores as four signed big-endian
 * int32 `Uid` fields. See docs/format/plugins.md.
 */

/** One installed VST3 class as Live's plug-in database lists it. */
export interface CatalogEntry {
  /** e.g. `device:vst3:instr:5653544e-694d-616d-6173-736976650000` */
  readonly devIdentifier: string
  readonly name: string
}

/** Installed VST3 plug-ins: 32 lower-case hex digits of the class id → entry. */
export type Catalog = ReadonlyMap<string, CatalogEntry>

const VST3_DEV_ID = /^device:vst3:\w+:([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/

/** Add the VST3 rows of Live's `plugins` table (later rows win). */
export function addCatalogRows(
  catalog: Map<string, CatalogEntry>,
  rows: Iterable<{ readonly devIdentifier: string; readonly name: string }>,
): Map<string, CatalogEntry> {
  for (const row of rows) {
    const m = VST3_DEV_ID.exec(row.devIdentifier ?? '')
    if (m)
      catalog.set((m[1] as string).replaceAll('-', ''), {
        devIdentifier: row.devIdentifier,
        name: row.name,
      })
  }
  return catalog
}

/** A class id as Live's four signed 32-bit `<Uid><Fields.n>` values. */
export function uidToFields(uid: string): number[] {
  return [0, 8, 16, 24].map((i) => Number.parseInt(uid.slice(i, i + 8), 16) | 0)
}

/** Live's four `Uid` fields back to 32 lower-case hex digits. */
export function fieldsToUid(fields: readonly number[]): string {
  return fields.map((f) => (f >>> 0).toString(16).padStart(8, '0')).join('')
}

/** A VST2 id as its four characters when printable ('XfsX'), else the number. */
export function fourCC(id: number): string {
  const n = id >>> 0
  const chars = [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
  return chars.every((c) => c >= 0x20 && c < 0x7f) ? String.fromCharCode(...chars) : String(id)
}

/**
 * Steinberg's VST2 → VST3 class id (VST3 SDK FAQ "Compatibility with VST 2.x"): `'VST'` (processor)
 * or `'VSE'` (controller) + the VST2 id (big-endian) + the first 9 bytes of the lower-cased effect
 * name, zero-padded to 16 bytes.
 */
export function vst2ToVst3Uid(vst2Id: number, effectName: string, controller = false): string {
  const bytes = new Uint8Array(16)
  bytes.set([0x56, 0x53, controller ? 0x45 : 0x54])
  new DataView(bytes.buffer).setUint32(3, vst2Id >>> 0, false)
  const name = new TextEncoder().encode(effectName.toLowerCase()).subarray(0, 9)
  bytes.set(name, 7)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** The installed VST3 an Ableton set would need for a plug-in, as Live's catalog lists it. */
export class Target {
  readonly uid: string
  readonly devIdentifier: string
  readonly name: string

  constructor(uid: string, devIdentifier: string, name: string) {
    this.uid = uid
    this.devIdentifier = devIdentifier
    this.name = name
  }

  /** Live's `DeviceType`: 1 instrument, 2 audio effect, undefined otherwise. */
  get deviceType(): 1 | 2 | undefined {
    const kind = this.devIdentifier.split(':')[2]
    return kind === 'instr' ? 1 : kind === 'audiofx' ? 2 : undefined
  }

  get fields(): number[] {
    return uidToFields(this.uid)
  }
}

/**
 * The installed VST3 whose class id was derived from this VST2 id ('VST'/'VSE' + id + name). Only
 * the first 7 bytes are compared (Ableton's PlugName is often a file name), and the first matching
 * class id in sorted order wins. With the plug-in's name, a class id whose name bytes match too is
 * preferred (several plug-ins sharing a VST2 id).
 */
export function derivedTarget(vst2Id: number, catalog: Catalog, name?: string): Target | undefined {
  const idHex = (vst2Id >>> 0).toString(16).padStart(8, '0')
  const matches = [...catalog.keys()]
    .sort()
    .filter(
      (uid) => (uid.startsWith('565354') || uid.startsWith('565345')) && uid.slice(6, 14) === idHex,
    )
  if (!matches.length) return undefined
  const exact = name
    ? matches.find(
        (uid) => uid === vst2ToVst3Uid(vst2Id, name) || uid === vst2ToVst3Uid(vst2Id, name, true),
      )
    : undefined
  const uid = exact ?? (matches[0] as string)
  const entry = catalog.get(uid) as CatalogEntry
  return new Target(uid, entry.devIdentifier, entry.name)
}

/** Hex of a four-character code ('XFER' → '58464552'). */
export function codeHex(code: string): string {
  return Array.from(code, (c) => (c.charCodeAt(0) & 0xff).toString(16).padStart(2, '0')).join('')
}

/** JUCE's default VST3 class id: `ABCDEF01 9182FAEB` + manufacturer code + plug-in code (AU codes). */
export const JUCE_PREFIX = 'abcdef019182faeb'
/** iPlug2's default VST3 class id: `F2AEE70D 00DE4F4E` + manufacturer code + unique id. */
export const IPLUG2_PREFIX = 'f2aee70d00de4f4e'

export function juceVst3Uid(manufacturer: string, plugin: string): string {
  return JUCE_PREFIX + codeHex(manufacturer) + codeHex(plugin)
}

export function iplug2Vst3Uid(manufacturer: string, uniqueId: string): string {
  return IPLUG2_PREFIX + codeHex(manufacturer) + codeHex(uniqueId)
}
