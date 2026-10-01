/**
 * The same plug-in in other formats: which installed VST2/VST3/AU versions belong to the product a
 * set refers to. Live never swaps formats by itself, but knowing that e.g. a native VST3 of an
 * Intel-only VST2 is installed tells what `plugins upgrade` (or re-saving in Live) can fix.
 *
 * Links, strongest first:
 * - `declared`: the VST3's moduleinfo.json lists the old class id as replaced
 * - `steinberg`: VST3 class id 'VST'/'VSE' + VST2 id (Steinberg's VST2 compatibility scheme)
 * - `juce` / `iplug2`: the frameworks' default VST3 class ids built from the AU codes
 * - `au-code`: the AU subtype equals the VST2 id (JUCE, Arturia, NI and others)
 * - `name`: only the name matches (a hint)
 */
import type { PluginFormat, PluginRef } from '@livesaver/core'
import { codeHex, IPLUG2_PREFIX, JUCE_PREFIX } from './identity.js'
import { type InstalledPlugin, type Inventory, simpleName } from './inventory.js'

export type Link = 'declared' | 'steinberg' | 'juce' | 'iplug2' | 'au-code' | 'name'
const STRENGTH: readonly Link[] = ['declared', 'steinberg', 'juce', 'iplug2', 'au-code', 'name']

export interface Alternative {
  readonly format: PluginFormat
  readonly ident: string
  readonly name: string
  /** Any processor row runs natively (unknown counts as native, like availability). */
  readonly native: boolean
  readonly paths: readonly string[]
  readonly link: Link
}

const hex8 = (n: number) => (n >>> 0).toString(16).padStart(8, '0')

/** Four characters from 8 hex digits ('58667358' → 'XfsX'), or undefined if not printable. */
function codeOf(hex: string): string | undefined {
  const bytes = [0, 2, 4, 6].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
  return bytes.every((b) => b >= 32 && b < 127) ? String.fromCharCode(...bytes) : undefined
}

/** AU ident parts ("type:subtype:manufacturer"). */
function auParts(ident: string): [string, string, string] | undefined {
  const p = ident.split(':')
  return p.length === 3 ? (p as [string, string, string]) : undefined
}

function isSteinberg(uid: string): boolean {
  return uid.startsWith('565354') || uid.startsWith('565345')
}

/** Installed plug-ins of the same product as `ref` in other formats (or a declared replacement). */
export function alternativesOf(ref: PluginRef, inventory: Inventory): Alternative[] {
  const found = new Map<string, { format: PluginFormat; ident: string; link: Link }>()
  const add = (format: PluginFormat, ident: string, link: Link) => {
    if (format === ref.format && ident === ref.ident) return
    if (!inventory.get(format, ident).length) return
    const k = `${format}\u0000${ident}`
    const had = found.get(k)
    if (!had || STRENGTH.indexOf(link) < STRENGTH.indexOf(had.link))
      found.set(k, { format, ident, link })
  }
  const all = inventory.all
  const vst3 = all.filter((e) => e.format === 'VST3')
  const byVst2Id = (id: number, link: Link) => {
    const code = codeOf(hex8(id))
    for (const e of vst3) {
      if (isSteinberg(e.ident) && e.ident.slice(6, 14) === hex8(id))
        add('VST3', e.ident, 'steinberg')
      if (code && e.ident.startsWith(JUCE_PREFIX) && e.ident.slice(24) === codeHex(code))
        add('VST3', e.ident, 'juce')
      if (e.ident.startsWith(IPLUG2_PREFIX) && e.ident.slice(24) === hex8(id))
        add('VST3', e.ident, 'iplug2')
    }
    for (const [old, news] of inventory.replacements) {
      if (isSteinberg(old) && old.slice(6, 14) === hex8(id))
        for (const n of news) add('VST3', n, 'declared')
    }
    add('VST2', String(id >>> 0), link)
    if (code)
      for (const e of all)
        if (e.format === 'AU' && auParts(e.ident)?.[1] === code) add('AU', e.ident, 'au-code')
  }
  if (ref.format === 'VST2') {
    byVst2Id(Number(ref.ident), 'au-code')
  } else if (ref.format === 'AU') {
    const parts = auParts(ref.ident)
    if (parts) {
      const [, subtype, manufacturer] = parts
      const vst2 = /^[\s\S]{4}$/.test(subtype) ? Number.parseInt(codeHex(subtype), 16) : Number.NaN
      if (Number.isFinite(vst2)) byVst2Id(vst2, 'au-code')
      for (const e of vst3) {
        if (subtype.length === 4 && manufacturer.length === 4) {
          if (e.ident === JUCE_PREFIX + codeHex(manufacturer) + codeHex(subtype))
            add('VST3', e.ident, 'juce')
          if (e.ident === IPLUG2_PREFIX + codeHex(manufacturer) + codeHex(subtype))
            add('VST3', e.ident, 'iplug2')
        }
      }
      for (const e of all)
        if (
          e.format === 'AU' &&
          auParts(e.ident)?.[1] === subtype &&
          auParts(e.ident)?.[2] === manufacturer
        )
          add('AU', e.ident, 'au-code')
    }
  } else {
    const uid = ref.ident
    for (const n of inventory.replacements.get(uid) ?? []) add('VST3', n, 'declared')
    if (isSteinberg(uid)) byVst2Id(Number.parseInt(uid.slice(6, 14), 16), 'steinberg')
    for (const prefix of [JUCE_PREFIX, IPLUG2_PREFIX]) {
      if (!uid.startsWith(prefix)) continue
      const link: Link = prefix === JUCE_PREFIX ? 'juce' : 'iplug2'
      const manufacturer = codeOf(uid.slice(16, 24))
      const plugin = codeOf(uid.slice(24, 32))
      if (plugin) add('VST2', String(Number.parseInt(uid.slice(24, 32), 16)), link)
      for (const e of all) {
        const p = e.format === 'AU' ? auParts(e.ident) : undefined
        if (p && p[1] === plugin && p[2] === manufacturer) add('AU', e.ident, link)
      }
    }
  }
  const wanted = simpleName(ref.name)
  if (wanted) {
    for (const e of all) {
      if (e.format !== ref.format && simpleName(e.name.split(': ').at(-1) ?? '') === wanted)
        add(e.format, e.ident, 'name')
    }
  }
  return [...found.values()]
    .map(({ format, ident, link }) => {
      const entries = inventory.get(format, ident) as InstalledPlugin[]
      return {
        format,
        ident,
        link,
        name: entries[0]?.name ?? '',
        native: entries.some((e) => e.native !== false),
        paths: [...new Set(entries.map((e) => e.path).filter((p) => p))].sort(),
      }
    })
    .sort(
      (a, b) =>
        STRENGTH.indexOf(a.link) - STRENGTH.indexOf(b.link) ||
        a.format.localeCompare(b.format) ||
        a.ident.localeCompare(b.ident),
    )
}
