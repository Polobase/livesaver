/**
 * The plug-in audit and a VST2 → VST3 upgrade as plain data for a user interface (no `Set`, no
 * `Map`, nothing that is lost in JSON), like `checkView` for samples. The report files say the
 * same in CSV and Markdown.
 */
import { compareCodePoints, type PluginFormat, pluginCode, posix } from '@livesaver/core'
import {
  type Alternative,
  type Availability,
  type Blocker,
  type Inventory,
  type Link,
  REASONS,
  simpleName,
} from '@livesaver/plugins'
import {
  type AuditResult,
  installedProducts,
  isLivePlugin,
  nativeAlternative,
  type PluginUse,
} from './audit.js'
import type { SetUpgrade } from './vst3.js'

/** `unknown`: what is installed was not known (a browser that was not given the plug-in folders). */
export type PluginState = Availability | 'unknown'

export interface AlternativeRow {
  readonly format: PluginFormat
  readonly ident: string
  readonly name: string
  readonly native: boolean
  /** How it is known to be the same plug-in; `name` is only a hint. */
  readonly link: Link
  readonly paths: readonly string[]
}

export interface PluginUseRow {
  /** Format, id and name: unique among the rows. */
  readonly key: string
  readonly format: PluginFormat
  readonly ident: string
  /** The id as people know it: four characters for VST2. */
  readonly code: string
  readonly name: string
  readonly state: PluginState
  readonly instances: number
  /** Relative to the common folder of the targets. */
  readonly sets: readonly string[]
  readonly projects: readonly string[]
  /** Keys of the installed rows it is found as. */
  readonly found: readonly string[]
  readonly installedAt: readonly string[]
  /** A bundle with its name that Live could not load. */
  readonly failedBundle: string
  readonly alternatives: readonly AlternativeRow[]
  /** The same plug-in in another format that runs natively (for a missing or Rosetta-only one). */
  readonly nativeAlternative?: AlternativeRow
  /** VST2 only: the installed VST3, and whether livesaver's conversion to it is verified. */
  readonly vst3?: { readonly uid: string; readonly name: string; readonly verified: boolean }
}

export interface InstalledRow {
  /** Format and id: unique among the rows. */
  readonly key: string
  readonly format: PluginFormat
  readonly ident: string
  readonly code: string
  readonly name: string
  /** Runs on Apple silicon; `false`: only under Rosetta. */
  readonly native: boolean
  /** Live's plug-in database knows it. */
  readonly scanned: boolean
  readonly version: string
  readonly paths: readonly string[]
  /** Live loads it as a device (not a codec, converter or output unit). */
  readonly device: boolean
  /** Sets that use it in this format. */
  readonly usedBySets: number
  /** No set uses it, not even in another format; Apple's own Audio Units never count. */
  readonly unused: boolean
}

export interface PluginsView {
  readonly base: string
  readonly sets: number
  readonly projects: number
  /** Whether what is installed was known. Without it every state is `unknown`. */
  readonly inventory: boolean
  readonly counts: {
    readonly used: number
    readonly missing: number
    readonly rosetta: number
    /** Missing or Rosetta-only, but installed natively in another format. */
    readonly nativeAlternative: number
    /** VST2 with its VST3 installed, and how many of them livesaver can convert. */
    readonly vst3: number
    readonly vst3Verified: number
    readonly unused: number
  }
  readonly uses: readonly PluginUseRow[]
  readonly installed: readonly InstalledRow[]
  readonly unreadable: readonly string[]
}

const productKey = (format: string, ident: string) => `${format}\u0000${ident}`

const alternativeRow = (a: Alternative): AlternativeRow => ({
  format: a.format,
  ident: a.ident,
  name: a.name,
  native: a.native,
  link: a.link,
  paths: a.paths,
})

/**
 * `inventory` left out: the sets were read where nothing is known about what is installed, so
 * the rows only say which plug-ins are used, and where.
 */
export function pluginsView(audit: AuditResult, inventory: Inventory | undefined): PluginsView {
  const rel = (path: string) => {
    const relative = posix.relpath(path, audit.base)
    return relative === '.' ? posix.basename(path) : relative
  }
  const sorted = (paths: Iterable<string>) => [...paths].map(rel).sort(compareCodePoints)
  const uses = audit.uses.map((u: PluginUse): PluginUseRow => {
    const native = u.state !== 'installed' ? nativeAlternative(u) : undefined
    return {
      key: `${u.ref.format}\u0000${u.ref.ident}\u0000${u.ref.name}`,
      format: u.ref.format,
      ident: u.ref.ident,
      code: pluginCode(u.ref),
      name: u.ref.name,
      state: inventory ? u.state : 'unknown',
      instances: u.instances,
      sets: sorted(u.sets),
      projects: sorted(u.projects),
      found: [...new Set(u.found.map((e) => productKey(e.format, e.ident)))],
      installedAt: [...new Set(u.found.map((e) => e.path).filter((p) => p))].sort(
        compareCodePoints,
      ),
      failedBundle: u.failedBundle,
      alternatives: u.alternatives.map(alternativeRow),
      ...(native ? { nativeAlternative: alternativeRow(native) } : {}),
      ...(u.vst3 ? { vst3: u.vst3 } : {}),
    }
  })
  const usedBy = new Map<string, number>()
  for (const u of audit.uses) {
    const key = productKey(u.ref.format, u.ref.ident)
    usedBy.set(key, (usedBy.get(key) ?? 0) + u.sets.size)
  }
  const unused = new Set(audit.unused.map((p) => productKey(p.format, p.ident)))
  const installed = (inventory ? installedProducts(inventory) : []).map((p): InstalledRow => {
    const key = productKey(p.format, p.ident)
    return {
      key,
      format: p.format,
      ident: p.ident,
      code:
        p.format === 'VST2'
          ? pluginCode({ format: 'VST2', ident: p.ident, name: p.name })
          : p.ident,
      name: p.name,
      native: p.native,
      scanned: p.scanned,
      version: p.paths.map((x) => inventory?.bundles.get(x)?.version ?? '').find((v) => v) ?? '',
      paths: p.paths,
      device: isLivePlugin(p),
      usedBySets: usedBy.get(key) ?? 0,
      unused: unused.has(key),
    }
  })
  const known = inventory !== undefined
  return {
    base: audit.base,
    sets: audit.sets,
    projects: audit.projects,
    inventory: known,
    counts: {
      used: uses.length,
      missing: known ? uses.filter((u) => u.state === 'missing').length : 0,
      rosetta: known ? uses.filter((u) => u.state === 'rosetta').length : 0,
      nativeAlternative: known ? uses.filter((u) => u.nativeAlternative).length : 0,
      vst3: uses.filter((u) => u.vst3).length,
      vst3Verified: uses.filter((u) => u.vst3?.verified).length,
      unused: audit.unused.length,
    },
    uses,
    installed,
    unreadable: audit.unreadable.map(rel),
  }
}

export interface UninstallView {
  /** Installed plug-ins of that name, in every format. */
  readonly removes: readonly InstalledRow[]
  /** Plug-ins in use that would then be missing. */
  readonly breaks: readonly PluginUseRow[]
  readonly sets: readonly string[]
  readonly projects: readonly string[]
}

/** What breaks if every installed plug-in called `name` (in any format) is uninstalled. */
export function uninstallView(view: PluginsView, name: string): UninstallView {
  const wanted = simpleName(name)
  const removes = view.installed.filter(
    (p) => simpleName(p.name.split(': ').at(-1) ?? '') === wanted || simpleName(p.name) === wanted,
  )
  const gone = new Set(removes.map((p) => p.key))
  const breaks = view.uses.filter(
    (u) =>
      u.state !== 'missing' &&
      u.state !== 'unknown' &&
      u.found.length > 0 &&
      u.found.every((key) => gone.has(key)),
  )
  return {
    removes,
    breaks,
    sets: [...new Set(breaks.flatMap((u) => u.sets))].sort(compareCodePoints),
    projects: [...new Set(breaks.flatMap((u) => u.projects))].sort(compareCodePoints),
  }
}

/** Why instances were not converted: the blocker, what it means, and how many instances. */
export interface BlockerCount {
  readonly blocker: Blocker
  readonly reason: string
  readonly instances: number
}

/** A plug-in over all sets: what an upgrade does to it. */
export interface UpgradePluginRow {
  readonly plugin: string
  readonly sets: number
  /** Sets in which every instance can be (or was) converted: it is all or nothing per set. */
  readonly convertibleSets: number
  readonly instances: number
  readonly convertibleInstances: number
  readonly blockers: readonly BlockerCount[]
  /** Converted instances whose custom parameter selection is reset. */
  readonly selectionsReset: number
}

export interface UpgradeSetRow {
  /** Relative to the common folder of the targets. */
  readonly project: string
  readonly set: string
  /** The project folder (absolute): what an upgrade of one project is given. */
  readonly root: string
  readonly live: string
  readonly plugin: string
  readonly instances: number
  readonly converted: boolean
  readonly blockers: readonly BlockerCount[]
  readonly selectionsReset: number
  readonly written: boolean
  readonly backup: string
  readonly error: string
}

export interface UpgradeView {
  readonly base: string
  readonly seconds: number
  readonly sets: number
  /** Sets an upgrade rewrites (or rewrote). */
  readonly changingSets: number
  readonly plugins: readonly UpgradePluginRow[]
  /** One row per plug-in per set, and one per unreadable set (with `error`, no plug-in). */
  readonly rows: readonly UpgradeSetRow[]
  /** VST2 plug-ins whose VST3 is installed but whose conversion is not verified: they stay. */
  readonly unverified: readonly { readonly plugin: string; readonly instances: number }[]
}

const blockersOf = (reasons: ReadonlyMap<Blocker, number>): BlockerCount[] =>
  [...reasons].map(([blocker, instances]) => ({ blocker, reason: REASONS[blocker], instances }))

export function upgradeView(run: {
  readonly results: readonly SetUpgrade[]
  readonly base: string
  readonly ms: number
}): UpgradeView {
  const rel = (path: string, base: string) => {
    const relative = posix.relpath(path, base)
    return relative === '.' ? posix.basename(path) : relative
  }
  const rows: UpgradeSetRow[] = []
  const totals = new Map<string, { row: UpgradePluginRow; blockers: Map<Blocker, number> }>()
  const unverified = new Map<string, number>()
  for (const r of run.results) {
    const common = {
      project: rel(r.projectRoot, run.base),
      set: posix.relpath(r.setPath, r.projectRoot),
      root: r.projectRoot,
      live: r.creator.replace('Ableton Live ', ''),
      written: r.written,
      backup: r.backup,
      error: r.error,
    }
    if (r.error && r.plugins.length === 0)
      rows.push({
        ...common,
        plugin: '',
        instances: 0,
        converted: false,
        blockers: [],
        selectionsReset: 0,
      })
    for (const p of r.plugins) {
      rows.push({
        ...common,
        plugin: p.plugin,
        instances: p.instances,
        converted: p.converted,
        blockers: blockersOf(p.reasons),
        selectionsReset: p.selectionsReset,
      })
      const total = totals.get(p.plugin) ?? {
        row: {
          plugin: p.plugin,
          sets: 0,
          convertibleSets: 0,
          instances: 0,
          convertibleInstances: 0,
          blockers: [],
          selectionsReset: 0,
        },
        blockers: new Map<Blocker, number>(),
      }
      for (const [blocker, n] of p.reasons)
        total.blockers.set(blocker, (total.blockers.get(blocker) ?? 0) + n)
      total.row = {
        ...total.row,
        sets: total.row.sets + 1,
        convertibleSets: total.row.convertibleSets + (p.converted ? 1 : 0),
        instances: total.row.instances + p.instances,
        convertibleInstances: total.row.convertibleInstances + (p.converted ? p.instances : 0),
        selectionsReset: total.row.selectionsReset + (p.converted ? p.selectionsReset : 0),
      }
      totals.set(p.plugin, total)
    }
    for (const [plugin, n] of r.unchecked) unverified.set(plugin, (unverified.get(plugin) ?? 0) + n)
  }
  return {
    base: run.base,
    seconds: run.ms / 1000,
    sets: run.results.length,
    changingSets: run.results.filter((r) => r.changed && !r.error).length,
    plugins: [...totals.values()]
      .map(({ row, blockers }) => ({ ...row, blockers: blockersOf(blockers) }))
      .sort((a, b) => compareCodePoints(a.plugin, b.plugin)),
    rows,
    unverified: [...unverified]
      .map(([plugin, instances]) => ({ plugin, instances }))
      .sort((a, b) => b.instances - a.instances || compareCodePoints(a.plugin, b.plugin)),
  }
}
