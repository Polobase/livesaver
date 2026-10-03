/**
 * Plug-in audit: which plug-ins the sets use, which are missing or load only under Rosetta, what is
 * installed in another (native) format, which VST2 plug-ins have their VST3 installed (candidates
 * for `plugins upgrade`), which installed plug-ins no set uses, and what breaks when a plug-in is
 * uninstalled. Read-only.
 */
import {
  compareCodePoints,
  type Host,
  inProcessParser,
  type PluginFormat,
  type PluginRef,
  type PluginUseCount,
  posix,
  type SetParser,
} from '@livesaver/core'
import {
  type Alternative,
  type Availability,
  alternativesOf,
  type Catalog,
  derivedTarget,
  type InstalledPlugin,
  type Inventory,
  KNOWN,
  simpleName,
} from '@livesaver/plugins'
import { findSets, projectRootOf } from './collect.js'
import { mapLimited } from './file-index.js'
import { Probe } from './probe.js'

export interface PluginUse {
  readonly ref: PluginRef
  instances: number
  readonly sets: Set<string>
  readonly projects: Set<string>
  readonly state: Availability
  readonly found: readonly InstalledPlugin[]
  /** A bundle with the plug-in's name that Live could not load. */
  readonly failedBundle: string
  readonly alternatives: readonly Alternative[]
  /** VST2 only: the VST3 Live's catalog lists for it, and whether livesaver's conversion is verified. */
  readonly vst3?: { readonly uid: string; readonly name: string; readonly verified: boolean }
}

/** An installed plug-in (all processor rows of one format and id). */
export interface InstalledProduct {
  readonly format: PluginFormat
  readonly ident: string
  readonly name: string
  readonly native: boolean
  readonly scanned: boolean
  readonly paths: readonly string[]
}

export interface AuditResult {
  readonly uses: PluginUse[]
  /**
   * Installed plug-ins none of the scanned sets uses, not even as another format of a used one
   * (Apple's own Audio Units left out).
   */
  readonly unused: InstalledProduct[]
  readonly sets: number
  readonly projects: number
  readonly unreadable: readonly string[]
  readonly base: string
}

/** What the sets are compared with. */
export interface AuditSources {
  readonly inventory: Inventory
  /** Live's VST3 catalog (class id → entry), for upgrade candidates. */
  readonly catalog?: Catalog
}

export interface AuditOptions extends AuditSources {
  readonly targets: readonly string[]
  readonly excludes?: readonly string[]
  readonly parser?: SetParser
  readonly onProgress?: (done: number, total: number) => void
}

/** The plug-ins of one set, as read from it. */
export interface SetPlugins {
  readonly setPath: string
  readonly projectRoot: string
  /** Left out: the set, or a plug-in device in it, could not be read. */
  readonly plugins?: readonly PluginUseCount[]
}

const useKey = (r: PluginRef) => `${r.format}\u0000${r.ident}\u0000${r.name}`
const productKey = (format: string, ident: string) => `${format}\u0000${ident}`
const RANK: Record<Availability, number> = { missing: 0, rosetta: 1, installed: 2 }

/** Installed plug-ins grouped per format and id. */
export function installedProducts(inventory: Inventory): InstalledProduct[] {
  const out: InstalledProduct[] = []
  for (const entries of inventory.entries.values()) {
    const first = entries[0] as InstalledPlugin
    out.push({
      format: first.format,
      ident: first.ident,
      name: entries.find((e) => e.name)?.name ?? '',
      native: entries.some((e) => e.native !== false),
      scanned: entries.some((e) => e.scanned),
      paths: [...new Set(entries.map((e) => e.path).filter((p) => p))].sort(compareCodePoints),
    })
  }
  return out.sort(
    (a, b) =>
      compareCodePoints(simpleName(a.name), simpleName(b.name)) ||
      compareCodePoints(a.format, b.format) ||
      compareCodePoints(a.ident, b.ident),
  )
}

/** Apple's own Audio Units (part of macOS, never "unused"). */
/** Audio Unit types Live loads as devices: instruments, effects, music effects, MIDI processors. */
export const LIVE_AU_TYPES: ReadonlySet<string> = new Set(['aumu', 'aufx', 'aumf', 'aumi'])

/** A plug-in Live can load (not a codec, converter or output unit). */
export function isLivePlugin(p: Pick<InstalledProduct, 'format' | 'ident'>): boolean {
  return p.format !== 'AU' || LIVE_AU_TYPES.has(p.ident.split(':')[0] as string)
}

function isSystem(p: InstalledProduct): boolean {
  return (
    p.format === 'AU' &&
    (p.ident.endsWith(':appl') || p.paths.every((x) => x.startsWith('/System/')))
  )
}

export async function auditPlugins(host: Host, options: AuditOptions): Promise<AuditResult> {
  const probe = new Probe(host.fs, host.hash)
  let base = posix.commonpath(options.targets)
  if (await probe.isFile(base)) base = posix.dirname(base)
  const paths = await findSets(options.targets, options.excludes ?? [], probe)
  const parser = options.parser ?? inProcessParser(host)
  let done = 0
  // Only the plug-ins are kept of each set: its XML is tens of megabytes.
  const read = await mapLimited(paths, 16, async (path) => {
    const parsed = await parser.parse(path)
    options.onProgress?.(++done, paths.length)
    return parsed.ok ? parsed.plugins : undefined
  })
  if (!options.parser) await parser.close()
  const sets: SetPlugins[] = []
  for (const [i, setPath] of paths.entries()) {
    const plugins = read[i]
    const projectRoot = await projectRootOf(setPath, probe)
    sets.push({ setPath, projectRoot, ...(plugins ? { plugins } : {}) })
  }
  return auditSets(sets, base, options)
}

/** The audit of sets whose plug-ins were read already (a scan reads them with the samples). */
export function auditSets(
  sets: readonly SetPlugins[],
  base: string,
  sources: AuditSources,
): AuditResult {
  const uses = new Map<string, PluginUse>()
  const projects = new Set<string>()
  const unreadable: string[] = []
  for (const { setPath, projectRoot, plugins } of sets) {
    if (!plugins) {
      unreadable.push(setPath)
      continue
    }
    projects.add(projectRoot)
    for (const { ref, instances } of plugins) {
      let use = uses.get(useKey(ref))
      if (!use) {
        const { state, found } = sources.inventory.status(ref)
        const target =
          ref.format === 'VST2' && sources.catalog
            ? derivedTarget(Number(ref.ident), sources.catalog, ref.name)
            : undefined
        const known = ref.format === 'VST2' ? KNOWN.get(Number(ref.ident)) : undefined
        const knownTarget = known?.vst3Uid ? sources.catalog?.get(known.vst3Uid) : undefined
        const vst3 = knownTarget
          ? { uid: known?.vst3Uid as string, name: knownTarget.name, verified: true }
          : target
            ? { uid: target.uid, name: target.name, verified: Boolean(known) }
            : undefined
        use = {
          ref,
          instances: 0,
          sets: new Set(),
          projects: new Set(),
          state,
          found,
          failedBundle: state === 'missing' ? sources.inventory.failedBundle(ref) : '',
          alternatives: alternativesOf(ref, sources.inventory),
          ...(vst3 ? { vst3 } : {}),
        }
        uses.set(useKey(ref), use)
      }
      use.instances += instances
      use.sets.add(setPath)
      use.projects.add(projectRoot)
    }
  }
  // Installed versions of a used plug-in in another format (e.g. the VST3 a VST2 can be upgraded
  // to) are not "unused": removing them takes that option away.
  const used = new Set<string>()
  for (const u of uses.values()) {
    used.add(productKey(u.ref.format, u.ref.ident))
    for (const a of u.alternatives) if (a.link !== 'name') used.add(productKey(a.format, a.ident))
  }
  const unused = installedProducts(sources.inventory).filter(
    (p) => !used.has(productKey(p.format, p.ident)) && !isSystem(p) && isLivePlugin(p),
  )
  const list = [...uses.values()].sort(
    (a, b) =>
      RANK[a.state] - RANK[b.state] ||
      b.projects.size - a.projects.size ||
      compareCodePoints(a.ref.name, b.ref.name),
  )
  return { uses: list, unused, sets: sets.length, projects: projects.size, unreadable, base }
}

/** A native alternative in another format, if one is installed. */
export function nativeAlternative(use: PluginUse): Alternative | undefined {
  return use.alternatives.find((a) => a.native && a.link !== 'name')
}

export interface UninstallImpact {
  /** Installed plug-ins matching the name (all formats). */
  readonly removes: InstalledProduct[]
  /** Plug-ins in use that would then be missing. */
  readonly breaks: PluginUse[]
  readonly sets: string[]
  readonly projects: string[]
}

/** What breaks if every installed plug-in called `name` (any format) is uninstalled. */
export function uninstallImpact(
  audit: AuditResult,
  inventory: Inventory,
  name: string,
): UninstallImpact {
  const wanted = simpleName(name)
  const removes = installedProducts(inventory).filter(
    (p) => simpleName(p.name.split(': ').at(-1) ?? '') === wanted || simpleName(p.name) === wanted,
  )
  const gone = new Set(removes.map((p) => productKey(p.format, p.ident)))
  const breaks = audit.uses.filter(
    (u) =>
      u.state !== 'missing' &&
      u.found.length > 0 &&
      u.found.every((e) => gone.has(productKey(e.format, e.ident))),
  )
  const sets = new Set<string>()
  const projects = new Set<string>()
  for (const u of breaks) {
    for (const s of u.sets) sets.add(s)
    for (const p of u.projects) projects.add(p)
  }
  return {
    removes,
    breaks,
    sets: [...sets].sort(compareCodePoints),
    projects: [...projects].sort(compareCodePoints),
  }
}
