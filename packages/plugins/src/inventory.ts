/**
 * Which plug-ins this Mac has for a set, matched by id as Live does (never by name), and whether
 * they run natively or only under Rosetta.
 *
 * Sources:
 * - Live's plug-in database (`Live-plugins-*.db`): the VST2 and VST3 plug-ins Live scanned. Every
 *   module is scanned once per processor: 2 = Apple Silicon (Live runs natively), 1 = Intel (Live
 *   runs under Rosetta). A plug-in with only Intel rows loads only under Rosetta.
 * - Audio Units: `auval -a` lists all registered components; Live asks the system for them. Whether
 *   a component runs natively comes from the architectures of its binary.
 * - Bundles Live has not scanned successfully (newly installed): the VST2 id equals the AU subtype
 *   of the same-named component (Arturia, JUCE); VST3 class ids are listed in `moduleinfo.json`.
 *
 * Everything here reads through the `FsRead` port; the database rows and `auval` come from the host.
 */

import {
  compareCodePoints,
  type FsRead,
  idCode,
  MACHO_HEAD_BYTES,
  machoArchs,
  norm,
  type PlistDict,
  type PlistValue,
  type PluginFormat,
  type PluginRef,
  parsePlist,
  posix,
} from '@livesaver/core'
import { type ModuleInfo, parseModuleInfo } from './moduleinfo.js'

export type Availability = 'installed' | 'rosetta' | 'missing'

export interface InstalledPlugin {
  readonly format: PluginFormat
  readonly ident: string
  readonly name: string
  /** The bundle ('' if unknown). */
  readonly path: string
  /** Runs on Apple Silicon; `undefined` = unknown (counts as native). */
  readonly native: boolean | undefined
  /** Live's database knows it. */
  readonly scanned: boolean
}

/** A row of Live's `plugins` table joined with its module. */
export interface DbPlugin {
  readonly devIdentifier: string | null
  readonly name: string | null
  readonly path: string | null
  readonly processor: number | null
}

/** A row of Live's `plugin_modules` table. */
export interface DbModule {
  readonly path: string | null
  readonly processor: number | null
  readonly scanstate: number | null
}

/** An Audio Unit: type, subtype, manufacturer (four-character codes) and name. */
export type AuComponent = readonly [
  type: string,
  subtype: string,
  manufacturer: string,
  name: string,
]

export const PROCESSOR_INTEL = 1
export const PROCESSOR_ARM = 2
/** Whether a row of the database runs natively, by its processor (`undefined`: it does not say). */
const nativeBy = (processor: number | null): boolean | undefined =>
  processor === PROCESSOR_ARM ? true : processor === PROCESSOR_INTEL ? false : undefined
export const SCAN_OK = 1

const key = (format: string, ident: string) => `${format}\u0000${ident}`

/** Name for loose comparisons: letters and digits only, without Windows DLL endings. */
export function simpleName(name: string): string {
  const text = norm(name).replace(/[^0-9a-z]/g, '')
  return text.replace(/(?:x64|x86|64|32|dll|vst3?|component)+$/, '') || text
}

/** What a plug-in bundle says about itself. */
export interface BundleInfo {
  readonly path: string
  readonly format: PluginFormat
  /** `CFBundleShortVersionString`, else `CFBundleVersion`. */
  readonly version: string
  /** `CFBundleIdentifier`, e.g. "com.xferrecords.Serum". */
  readonly identifier: string
  /** Runs on Apple Silicon (`undefined`: no readable binary). */
  readonly native: boolean | undefined
  /** VST3 only. */
  readonly moduleInfo?: ModuleInfo
}

/** Installed plug-ins by (format, id). */
export class Inventory {
  readonly entries: ReadonlyMap<string, readonly InstalledPlugin[]>
  /** Bundles whose scan failed in Live for every processor. */
  readonly failed: readonly string[]
  readonly all: readonly InstalledPlugin[]
  /** Every bundle in the plug-in folders (and those Live's database names), by path. */
  readonly bundles: ReadonlyMap<string, BundleInfo>
  /** VST3 class ids a bundle declares as replacements: old class id → new class ids. */
  readonly replacements: ReadonlyMap<string, readonly string[]>

  constructor(
    entries: readonly InstalledPlugin[],
    failed: readonly string[] = [],
    bundles: ReadonlyMap<string, BundleInfo> = new Map(),
  ) {
    const map = new Map<string, InstalledPlugin[]>()
    for (const e of entries) {
      const k = key(e.format, e.ident)
      const list = map.get(k)
      if (list) list.push(e)
      else map.set(k, [e])
    }
    this.entries = map
    this.failed = [...failed]
    this.all = [...entries]
    this.bundles = bundles
    const replacements = new Map<string, string[]>()
    for (const b of bundles.values()) {
      for (const [next, old] of b.moduleInfo?.compatibility ?? []) {
        for (const o of old) replacements.set(o, [...(replacements.get(o) ?? []), next])
      }
    }
    this.replacements = replacements
  }

  /** Installed entries of a format and id (every processor row). */
  get(format: PluginFormat, ident: string): readonly InstalledPlugin[] {
    return this.entries.get(key(format, ident)) ?? []
  }

  status(ref: PluginRef): { state: Availability; found: InstalledPlugin[] } {
    let found = [...(this.entries.get(key(ref.format, ref.ident)) ?? [])]
    if (ref.format === 'VST2' && new Set(found.map((e) => simpleName(e.name))).size > 1) {
      // Shared ids (e.g. all "Captain" plug-ins): the name tells them apart.
      const wanted = simpleName(ref.name)
      const same = found.filter((e) => simpleName(e.name) === wanted)
      if (same.length) found = same
    }
    if (found.length === 0) return { state: 'missing', found: [] }
    if (found.some((e) => e.native !== false)) return { state: 'installed', found }
    return { state: 'rosetta', found }
  }

  /** A bundle with the plug-in's name that Live could not load at all (a hint, not a match). */
  failedBundle(ref: PluginRef): string {
    const wanted = simpleName(ref.name)
    if (!wanted) return ''
    for (const path of this.failed) {
      if (simpleName(posix.splitext(posix.basename(path))[0]) === wanted) return path
    }
    return ''
  }
}

const DEV_ID_RE = /^device:(vst|vst3|au):[\p{L}\p{N}_]+:([^?]+)/u
const isDigits = (s: string) => /^\p{Nd}+$/u.test(s)

/** Format and id of a `dev_identifier` of Live's database. */
export function identOf(
  devIdentifier: string,
): { format: PluginFormat; ident: string } | undefined {
  const m = DEV_ID_RE.exec(devIdentifier)
  if (!m) return undefined
  const kind = m[1] as string
  const value = m[2] as string
  if (kind === 'vst') return isDigits(value) ? { format: 'VST2', ident: value } : undefined
  if (kind === 'vst3') {
    const uid = value.replaceAll('-', '').toLowerCase()
    return /^[0-9a-f]{32}$/.test(uid) ? { format: 'VST3', ident: uid } : undefined
  }
  const parts = value.split(':') // au: manufacturer:subtype:type as numbers
  if (parts.length === 3 && parts.every((p) => isDigits(p.replace(/^-+/, '')))) {
    const [manufacturer, subtype, type] = parts.map((p) => Number(p)) as [number, number, number]
    return { format: 'AU', ident: `${idCode(type)}:${idCode(subtype)}:${idCode(manufacturer)}` }
  }
  return undefined
}

/** Read access to plug-in bundles (Info.plist, binaries), with results cached per bundle. */
export class Bundles {
  private readonly fs: FsRead
  private readonly plists = new Map<string, Promise<PlistDict>>()
  private readonly natives = new Map<string, Promise<boolean | undefined>>()

  constructor(fs: FsRead) {
    this.fs = fs
  }

  /** `Contents/Info.plist` as a dictionary ({} if missing or unreadable). */
  info(bundle: string): Promise<PlistDict> {
    let p = this.plists.get(bundle)
    if (!p) {
      p = (async () => {
        try {
          const value = parsePlist(
            await this.fs.readFile(posix.join(bundle, 'Contents', 'Info.plist')),
          )
          return isDict(value) ? value : {}
        } catch {
          return {}
        }
      })()
      this.plists.set(bundle, p)
    }
    return p
  }

  /** Whether the bundle's binary contains Apple Silicon code (`undefined` if unknown). */
  native(bundle: string): Promise<boolean | undefined> {
    let p = this.natives.get(bundle)
    if (!p) {
      p = (async () => {
        const folder = posix.join(bundle, 'Contents', 'MacOS')
        const executable = (await this.info(bundle)).CFBundleExecutable
        const name = typeof executable === 'string' ? executable : ''
        let candidates = name ? [posix.join(folder, name)] : []
        if (candidates.length === 0) {
          const entries = (await this.fs.listDir(folder)) ?? []
          candidates = entries
            .map((e) => e.name)
            .filter((n) => !n.startsWith('.'))
            .sort(compareCodePoints)
            .map((n) => posix.join(folder, n))
        }
        const archs = new Set<string>()
        for (const c of candidates) {
          try {
            for (const a of machoArchs(await this.fs.read(c, 0, MACHO_HEAD_BYTES))) archs.add(a)
          } catch {}
        }
        return archs.size ? archs.has('arm64') : undefined
      })()
      this.natives.set(bundle, p)
    }
    return p
  }

  /** Version, identifier, architecture and (VST3) moduleinfo.json of a bundle. */
  async describe(bundle: string, format: PluginFormat): Promise<BundleInfo> {
    const info = await this.info(bundle)
    const text = (v: PlistValue | undefined) => (typeof v === 'string' ? v : '')
    let moduleInfo: ModuleInfo | undefined
    if (format === 'VST3') {
      for (const place of [['Contents', 'Resources'], ['Contents']]) {
        try {
          const raw = await this.fs.readFile(posix.join(bundle, ...place, 'moduleinfo.json'))
          moduleInfo = parseModuleInfo(new TextDecoder().decode(raw))
          if (moduleInfo) break
        } catch {}
      }
    }
    return {
      path: bundle,
      format,
      version: text(info.CFBundleShortVersionString) || text(info.CFBundleVersion),
      identifier: text(info.CFBundleIdentifier),
      native: await this.native(bundle),
      ...(moduleInfo ? { moduleInfo } : {}),
    }
  }

  /** The Audio Units a component bundle declares in its Info.plist. */
  async audioComponents(bundle: string): Promise<AuComponent[]> {
    const list = (await this.info(bundle)).AudioComponents
    if (!Array.isArray(list)) return []
    const found: AuComponent[] = []
    for (const entry of list) {
      if (!isDict(entry)) continue
      const { type, subtype, manufacturer, name } = entry
      if (
        typeof type !== 'string' ||
        typeof subtype !== 'string' ||
        typeof manufacturer !== 'string'
      )
        continue
      found.push([type, subtype, manufacturer, name === undefined ? '' : pyStr(name)])
    }
    return found
  }
}

function isDict(v: PlistValue | undefined): v is PlistDict {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    !(v instanceof Uint8Array) &&
    !(v instanceof Date)
  )
}

function pyStr(v: PlistValue): string {
  if (typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  if (typeof v === 'number' || typeof v === 'bigint') return String(v)
  return ''
}

/** `glob(<dir>/*<extension>)`: names not starting with ".", case-sensitive, files and folders. */
async function globIn(
  fs: FsRead,
  dir: string,
  extension: string,
  dirsOnly = false,
): Promise<string[]> {
  const entries = (await fs.listDir(dir)) ?? []
  return entries
    .filter(
      (e) => !e.name.startsWith('.') && e.name.endsWith(extension) && (!dirsOnly || e.isDirectory),
    )
    .map((e) => posix.join(dir, e.name))
}

/** Bundles in `<root>/<folder>/*<ext>` and one vendor level below, sorted. */
export async function findBundles(
  fs: FsRead,
  roots: readonly string[],
  folder: string,
  extension: string,
): Promise<string[]> {
  const found: string[] = []
  for (const root of roots) {
    const base = posix.join(root, folder)
    found.push(...(await globIn(fs, base, extension)))
    for (const vendor of await globIn(fs, base, '', true))
      found.push(...(await globIn(fs, vendor, extension)))
  }
  return found.sort(compareCodePoints)
}

export interface InventorySources {
  /** Rows of Live's plug-in databases. */
  readonly database: {
    readonly plugins: readonly DbPlugin[]
    readonly modules: readonly DbModule[]
  }
  /** e.g. `/Library/Audio/Plug-Ins` and `~/Library/Audio/Plug-Ins`. */
  readonly pluginRoots: readonly string[]
  /** `/System/Library/Components` ('' to skip). */
  readonly systemComponents?: string
  /** All registered Audio Units (`auval -a`); leave out to skip. */
  readonly registeredAudioUnits?: (components: readonly string[]) => Promise<readonly AuComponent[]>
  /** One kind of processor (Windows has no Rosetta): no row says "Intel only". */
  readonly oneProcessor?: boolean
  /** The files the rows name cannot be looked at (a page on Windows): a row counts as it is. */
  readonly unseenFiles?: boolean
}

/** The installed plug-ins. */
export async function loadInventory(fs: FsRead, sources: InventorySources): Promise<Inventory> {
  const bundles = new Bundles(fs)
  const exists = async (path: string) => (await fs.stat(path)) !== undefined
  const entries: InstalledPlugin[] = []
  const knownPaths = new Set<string>()
  for (const row of sources.database.plugins) {
    const ident = identOf(row.devIdentifier ?? '')
    const path = row.path ?? ''
    if (!ident || (path && !sources.unseenFiles && !(await exists(path)))) continue
    knownPaths.add(norm(path))
    let native = sources.oneProcessor ? undefined : nativeBy(row.processor)
    if (native === undefined && path && !sources.oneProcessor) native = await bundles.native(path)
    entries.push({ ...ident, name: row.name ?? '', path, native, scanned: true })
  }
  const scans = new Map<string, Set<boolean>>()
  for (const m of sources.database.modules) {
    const k = norm(m.path ?? '')
    const set = scans.get(k) ?? new Set<boolean>()
    set.add(m.scanstate === SCAN_OK)
    scans.set(k, set)
  }
  const failedSet = new Set<string>()
  for (const m of sources.database.modules) {
    const path = m.path
    if (!path || knownPaths.has(norm(path))) continue
    if ([...(scans.get(norm(path)) ?? [])].some(Boolean)) continue
    if (sources.unseenFiles || (await exists(path))) failedSet.add(path)
  }
  const failed = [...failedSet].sort(compareCodePoints)

  const components = await findBundles(fs, sources.pluginRoots, 'Components', '.component')
  const system = sources.systemComponents ?? ''
  if (system && (await fs.stat(system))?.isDirectory)
    components.push(...(await globIn(fs, system, '.component')).sort(compareCodePoints))
  const byCodes = new Map<string, string>()
  const byName = new Map<string, string>()
  const declared: AuComponent[] = []
  for (const bundle of components) {
    for (const au of await bundles.audioComponents(bundle)) {
      const codes = `${au[0]}:${au[1]}:${au[2]}`
      if (!byCodes.has(codes)) byCodes.set(codes, bundle)
      declared.push(au)
    }
    const name = simpleName(posix.splitext(posix.basename(bundle))[0])
    if (!byName.has(name)) byName.set(name, bundle)
  }

  const registered = [
    ...(sources.registeredAudioUnits ? await sources.registeredAudioUnits(components) : []),
    ...declared,
  ]
  const seen = new Set(entries.map((e) => key(e.format, e.ident)))
  for (const [type, subtype, manufacturer, name] of registered) {
    const ident = `${type}:${subtype}:${manufacturer}`
    if (seen.has(key('AU', ident))) continue
    seen.add(key('AU', ident))
    // Old components register through a resource instead of Info.plist: find them by name.
    const cut = name.indexOf(': ')
    const bundle =
      byCodes.get(ident) || byName.get(simpleName(cut < 0 ? name : name.slice(cut + 2))) || ''
    entries.push({
      format: 'AU',
      ident,
      name,
      path: bundle,
      native: bundle ? await bundles.native(bundle) : undefined,
      scanned: false,
    })
  }

  for (const bundle of await findBundles(fs, sources.pluginRoots, 'VST', '.vst')) {
    if (knownPaths.has(norm(bundle))) continue
    const sibling = byName.get(simpleName(posix.splitext(posix.basename(bundle))[0]))
    for (const [, subtype, , name] of sibling ? await bundles.audioComponents(sibling) : []) {
      let id = 0n
      for (const ch of subtype) id = (id << 8n) | BigInt((ch.codePointAt(0) as number) & 0xff)
      entries.push({
        format: 'VST2',
        ident: id.toString(),
        name: name || posix.basename(bundle),
        path: bundle,
        native: await bundles.native(bundle),
        scanned: false,
      })
    }
  }
  for (const bundle of await findBundles(fs, sources.pluginRoots, 'VST3', '.vst3')) {
    if (knownPaths.has(norm(bundle))) continue
    let cids: string[] = []
    try {
      const text = new TextDecoder().decode(
        await fs.readFile(posix.join(bundle, 'Contents', 'Resources', 'moduleinfo.json')),
      )
      cids = [...text.matchAll(/"CID"\s*:\s*"([0-9A-Fa-f]{32})"/g)].map((m) => m[1] as string)
    } catch {}
    for (const cid of cids) {
      entries.push({
        format: 'VST3',
        ident: cid.toLowerCase(),
        name: posix.splitext(posix.basename(bundle))[0],
        path: bundle,
        native: await bundles.native(bundle),
        scanned: false,
      })
    }
  }
  const infos = new Map<string, BundleInfo>()
  const describe = async (path: string, format: PluginFormat) => {
    if (path && !infos.has(path) && (await fs.stat(path)))
      infos.set(path, await bundles.describe(path, format))
  }
  for (const [folder, ext, format] of [
    ['VST', '.vst', 'VST2'],
    ['VST3', '.vst3', 'VST3'],
    ['Components', '.component', 'AU'],
  ] as const) {
    for (const b of await findBundles(fs, sources.pluginRoots, folder, ext))
      await describe(b, format)
  }
  for (const e of entries) await describe(e.path, e.format)
  return new Inventory(entries, failed, infos)
}
