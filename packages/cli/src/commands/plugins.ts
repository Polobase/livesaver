import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import type { SetParser } from '@livesaver/core'
import {
  createNodeHost,
  createWorkerParser,
  liveIsRunning,
  loadInstalledPlugins,
  readPluginCatalog,
} from '@livesaver/node'
import {
  AUDIT_FILES,
  type AuditResult,
  applyWriter,
  auditPlugins,
  auditReports,
  auditSummary,
  installedProducts,
  isLivePlugin,
  Probe,
  type RunContext,
  type SetUpgrade,
  UPGRADE_REPORT,
  uninstallImpact,
  uninstallText,
  upgradePlugins,
  upgradeReport,
  upgradeSummary,
} from '@livesaver/ops'
import { type Catalog, type Inventory, KNOWN } from '@livesaver/plugins'
import pc from 'picocolors'
import { absolute } from '../config.js'
import { join } from '../paths.js'
import { acquireLock, audioUnitsCachePath, endRun, newRun } from '../state.js'

/** What is installed on this computer, and the VST3 plug-ins Live knows. */
export interface PluginSources {
  readonly inventory: Inventory
  readonly catalog: Catalog
}

export async function loadPluginSources(auval = true): Promise<PluginSources> {
  const inventory = await loadInstalledPlugins({ auvalCache: audioUnitsCachePath(), auval })
  return { inventory, catalog: await readPluginCatalog() }
}

/** The plug-ins `plugins upgrade` can convert, by name. */
export function upgradablePlugins(): string[] {
  return [...KNOWN.values()].map((known) => known.name).sort()
}

export interface UpgradeFlags {
  readonly apply?: boolean
  readonly force?: boolean
  readonly plugin?: string[]
  readonly exclude?: string[]
  readonly reportDir?: string
  readonly json?: boolean
  readonly workers?: string
}

/** What an upgrade needs beyond the command line's flags. */
export interface UpgradeHooks {
  readonly onSet?: (result: SetUpgrade, index: number, total: number) => void
  /** Told the run folder as soon as there is one: what a run that fails did is in there. */
  readonly onRun?: (run: RunContext) => void
  /** The VST3 plug-ins Live knows, in place of reading its database. */
  readonly catalog?: Catalog
  /** `false`: a dry run leaves no run folder behind (a page plans far more often than it applies). */
  readonly record?: boolean
  /** Sets that need not be read: nothing in them is converted or reported (see `UpgradeOptions`). */
  readonly skip?: (setPath: string) => boolean
}

export interface UpgradeRun {
  readonly results: SetUpgrade[]
  readonly base: string
  readonly ms: number
  /** The run folder: with the report and, applied, journal and originals. */
  readonly run: RunContext | undefined
  readonly reportDir: string | undefined
  /** The report file's content. */
  readonly report: string
}

/**
 * `plugins upgrade` without the printing: the dry run plans, `apply` writes with backup and
 * journal. The caller checks that Live is not running and holds the lock when applying.
 */
export async function upgradeRun(
  targets: readonly string[],
  flags: UpgradeFlags,
  hooks: UpgradeHooks = {},
): Promise<UpgradeRun> {
  const apply = Boolean(flags.apply)
  const catalog = hooks.catalog ?? (await readPluginCatalog())
  if (catalog.size === 0) throw new Error("No VST3 plug-ins in Live's plug-in database.")
  const trash = process.env.LIVESAVER_TRASH_DIR
  const host = createNodeHost({ write: apply, ...(trash ? { trashDir: trash } : {}) })
  const only = flags.plugin ?? []
  const excludes = (flags.exclude ?? []).map(absolute)
  const run =
    apply || hooks.record !== false
      ? await newRun('vst3', apply, { targets, options: { plugin: only, exclude: excludes } })
      : undefined
  if (run) hooks.onRun?.(run)
  const probe = new Probe(host.fs, host.hash)
  const parser = createWorkerParser({
    host,
    ...(flags.workers !== undefined ? { workers: Number(flags.workers) } : {}),
  })
  let result: Awaited<ReturnType<typeof upgradePlugins>>
  try {
    result = await upgradePlugins(host, {
      targets,
      excludes,
      catalog,
      only,
      probe,
      parser,
      ...(apply && run ? { writer: applyWriter(host, run, probe) } : {}),
      ...(hooks.onSet ? { onSet: hooks.onSet } : {}),
      ...(hooks.skip ? { skip: hooks.skip } : {}),
    })
  } finally {
    await parser.close()
  }
  const report = upgradeReport(result.results, result.base)
  const reportDir = flags.reportDir ? absolute(flags.reportDir) : run?.dir
  if (reportDir) {
    mkdirSync(reportDir, { recursive: true })
    writeFileSync(join(reportDir, UPGRADE_REPORT), report)
  }
  if (run)
    await endRun(run, {
      sets: result.results.length,
      changingSets: result.results.filter((set) => set.changed && !set.error).length,
      written: result.results.filter((set) => set.written).length,
      errors: result.results.filter((set) => set.error).length,
    })
  return { ...result, run, reportDir, report }
}

export async function runUpgrade(targetArgs: string[], flags: UpgradeFlags): Promise<number> {
  const apply = Boolean(flags.apply)
  const targets = targetArgs.map(absolute)
  for (const target of targets) {
    if (!existsSync(target)) {
      console.error(`not found: ${target}`)
      return 2
    }
  }
  const names = upgradablePlugins()
  const unknown = (flags.plugin ?? []).filter(
    (p) => !names.some((n) => n.toLowerCase() === p.toLowerCase()),
  )
  if (unknown.length) {
    console.error(`unknown plug-in: ${unknown.join(', ')} (${names.join(', ')})`)
    return 2
  }
  if (apply && liveIsRunning() && !flags.force) {
    console.error(
      'Ableton Live is running – quit it first so no open set gets overwritten (or use --force).',
    )
    return 1
  }
  const catalog = await readPluginCatalog()
  if (catalog.size === 0) {
    console.error("No VST3 plug-ins in Live's plug-in database.")
    return 1
  }
  const release = apply ? acquireLock() : () => {}
  try {
    const tty = process.stderr.isTTY && !flags.json
    const { results, ms, run, reportDir } = await upgradeRun(targets, flags, {
      catalog,
      onSet: (r, i, n) => {
        if (tty) process.stderr.write(`\r\x1b[2K[${i}/${n}] ${r.setPath.slice(-80)}`)
      },
    })
    if (tty) process.stderr.write('\r\x1b[2K')
    if (flags.json) {
      console.log(
        JSON.stringify(
          {
            run: run?.id,
            reports: reportDir,
            sets: results.map((r) => ({
              set: r.setPath,
              changed: r.changed,
              written: r.written || undefined,
              backup: r.backup || undefined,
              error: r.error || undefined,
              plugins: r.plugins.map((p) => ({ ...p, reasons: Object.fromEntries(p.reasons) })),
              unchecked: Object.fromEntries(r.unchecked),
            })),
          },
          null,
          2,
        ),
      )
    } else {
      console.log(upgradeSummary(results, apply))
      console.log(pc.dim(`Time: ${(ms / 1000).toFixed(1)} s`))
      console.log(pc.dim(`Report: ${reportDir}`))
      if (apply && run) console.log(pc.dim(`Undo: livesaver undo ${run.id}`))
    }
    return results.some((r) => r.error) ? 1 : 0
  } finally {
    release()
  }
}

export interface ListFlags {
  readonly json?: boolean
  readonly format?: string
  readonly rosetta?: boolean
  readonly unscanned?: boolean
  readonly auval?: boolean
}

/** `livesaver plugins list`: the plug-ins installed on this Mac. */
export async function runList(flags: ListFlags): Promise<number> {
  const inventory = await loadInstalledPlugins({
    auvalCache: audioUnitsCachePath(),
    auval: flags.auval !== false,
  })
  const format = flags.format?.toUpperCase().replace(/^VST$/, 'VST2')
  const products = installedProducts(inventory).filter(
    (p) =>
      isLivePlugin(p) &&
      (!format || p.format === format) &&
      (!flags.rosetta || !p.native) &&
      (!flags.unscanned || !p.scanned),
  )
  if (flags.json) {
    console.log(
      JSON.stringify(
        products.map((p) => ({
          ...p,
          bundles: p.paths.map((path) => inventory.bundles.get(path)).filter(Boolean),
        })),
        null,
        2,
      ),
    )
    return 0
  }
  for (const p of products) {
    const version = p.paths.map((x) => inventory.bundles.get(x)?.version).find((v) => v) ?? ''
    const flagsText = [
      p.native ? '' : pc.yellow('Rosetta only'),
      p.scanned ? '' : pc.dim('not scanned by Live'),
    ]
      .filter(Boolean)
      .join(' ')
    console.log(
      `${p.name || p.ident}  ${pc.dim(`${p.format}${version ? ` ${version}` : ''}`)}${flagsText ? `  ${flagsText}` : ''}`,
    )
  }
  console.log(pc.dim(`${products.length} plug-ins`))
  return 0
}

export interface AuditFlags {
  readonly exclude?: string[]
  readonly uninstall?: string
  readonly reportDir?: string
  readonly json?: boolean
  readonly workers?: string
  readonly auval?: boolean
}

/** What an audit needs beyond the command line's flags. */
export interface AuditHooks {
  readonly onProgress?: (done: number, total: number) => void
  /** What is installed and what Live knows, in place of looking it up. */
  readonly sources?: PluginSources
  /** A parser whose workers are running already; it stays open. */
  readonly parser?: SetParser
}

export interface AuditRun {
  readonly audit: AuditResult
  readonly inventory: Inventory
  readonly catalog: Catalog
  /** The report files: name → content. */
  readonly reports: Record<string, string>
}

/** `plugins audit` without the printing and without a run folder: it only reads. */
export async function auditRun(
  targets: readonly string[],
  flags: AuditFlags,
  hooks: AuditHooks = {},
): Promise<AuditRun> {
  const { inventory, catalog } = hooks.sources ?? (await loadPluginSources(flags.auval !== false))
  const host = createNodeHost()
  const parser =
    hooks.parser ??
    createWorkerParser({
      host,
      ...(flags.workers !== undefined ? { workers: Number(flags.workers) } : {}),
    })
  try {
    const audit = await auditPlugins(host, {
      targets,
      excludes: (flags.exclude ?? []).map(absolute),
      inventory,
      catalog,
      parser,
      ...(hooks.onProgress ? { onProgress: hooks.onProgress } : {}),
    })
    const reports = Object.fromEntries(auditReports(audit, inventory))
    return { audit, inventory, catalog, reports }
  } finally {
    if (!hooks.parser) await parser.close()
  }
}

/** `livesaver plugins audit`: plug-ins used by the sets, against what is installed. */
export async function runAudit(targetArgs: string[], flags: AuditFlags): Promise<number> {
  const targets = targetArgs.map(absolute)
  for (const target of targets) {
    if (!existsSync(target)) {
      console.error(`not found: ${target}`)
      return 2
    }
  }
  const started = performance.now()
  const tty = process.stderr.isTTY && !flags.json
  const { audit, inventory, reports } = await auditRun(targets, flags, {
    onProgress: (done, total) => {
      if (tty) process.stderr.write(`\r\x1b[2K[${done}/${total}]`)
    },
  })
  if (tty) process.stderr.write('\r\x1b[2K')
  const run = await newRun('plugin-audit', false, {
    targets,
    options: { exclude: flags.exclude ?? [] },
  })
  const reportDir = flags.reportDir ? absolute(flags.reportDir) : run.dir
  mkdirSync(reportDir, { recursive: true })
  for (const [name, content] of Object.entries(reports))
    writeFileSync(join(reportDir, name), content)
  await endRun(run, {
    sets: audit.sets,
    plugins: audit.uses.length,
    missing: audit.uses.filter((use) => use.state === 'missing').length,
  })
  const impact = flags.uninstall ? uninstallImpact(audit, inventory, flags.uninstall) : undefined
  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          reports: reportDir,
          sets: audit.sets,
          projects: audit.projects,
          uses: audit.uses.map((u) => ({
            ...u,
            sets: [...u.sets],
            projects: [...u.projects],
            found: undefined,
            installedAt: [...new Set(u.found.map((e) => e.path).filter((p) => p))],
          })),
          unused: audit.unused,
          unreadable: audit.unreadable,
          ...(impact
            ? {
                uninstall: {
                  removes: impact.removes,
                  breaks: impact.breaks.map((u) => u.ref),
                  sets: impact.sets,
                  projects: impact.projects,
                },
              }
            : {}),
        },
        null,
        2,
      ),
    )
  } else {
    console.log(auditSummary(audit))
    if (impact && flags.uninstall)
      console.log(`\n${uninstallText(impact, flags.uninstall, audit.base)}`)
    console.log(pc.dim(`Time: ${((performance.now() - started) / 1000).toFixed(1)} s`))
    console.log(pc.dim(`Report: ${join(reportDir, AUDIT_FILES.overview)}`))
  }
  return 0
}
