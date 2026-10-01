import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createNodeHost,
  createWorkerParser,
  liveIsRunning,
  loadInstalledPlugins,
  readPluginCatalog,
} from '@livesaver/node'
import {
  AUDIT_FILES,
  applyWriter,
  auditPlugins,
  auditReports,
  auditSummary,
  installedProducts,
  isLivePlugin,
  Probe,
  UPGRADE_REPORT,
  uninstallImpact,
  uninstallText,
  upgradePlugins,
  upgradeReport,
  upgradeSummary,
} from '@livesaver/ops'
import { KNOWN } from '@livesaver/plugins'
import pc from 'picocolors'
import { absolute } from '../config.js'
import { acquireLock, audioUnitsCachePath, newRun } from '../state.js'

export interface UpgradeFlags {
  readonly apply?: boolean
  readonly force?: boolean
  readonly plugin?: string[]
  readonly exclude?: string[]
  readonly reportDir?: string
  readonly json?: boolean
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
  const names = [...KNOWN.values()].map((k) => k.name).sort()
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
    const trash = process.env.LIVESAVER_TRASH_DIR
    const host = createNodeHost({ write: apply, ...(trash ? { trashDir: trash } : {}) })
    const run = await newRun('vst3', apply)
    const probe = new Probe(host.fs, host.hash)
    const result = await upgradePlugins(host, {
      targets,
      excludes: (flags.exclude ?? []).map(absolute),
      catalog,
      only: flags.plugin ?? [],
      probe,
      ...(apply ? { writer: applyWriter(host, run, probe) } : {}),
      onSet: (r, i, n) => {
        if (process.stderr.isTTY && !flags.json)
          process.stderr.write(`\r\x1b[2K[${i}/${n}] ${r.setPath.slice(-80)}`)
      },
    })
    if (process.stderr.isTTY && !flags.json) process.stderr.write('\r\x1b[2K')
    const reportDir = flags.reportDir ? absolute(flags.reportDir) : run.dir
    mkdirSync(reportDir, { recursive: true })
    writeFileSync(join(reportDir, UPGRADE_REPORT), upgradeReport(result.results, result.base))
    if (flags.json) {
      console.log(
        JSON.stringify(
          {
            run: run.id,
            reports: reportDir,
            sets: result.results.map((r) => ({
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
      console.log(upgradeSummary(result.results, apply))
      console.log(pc.dim(`Time: ${(result.ms / 1000).toFixed(1)} s`))
      console.log(pc.dim(`Report: ${reportDir}`))
      if (apply) console.log(pc.dim(`Undo: livesaver undo ${run.id}`))
    }
    return result.results.some((r) => r.error) ? 1 : 0
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
  const inventory = await loadInstalledPlugins({
    auvalCache: audioUnitsCachePath(),
    auval: flags.auval !== false,
  })
  const catalog = await readPluginCatalog()
  const host = createNodeHost()
  const parser = createWorkerParser({
    host,
    ...(flags.workers !== undefined ? { workers: Number(flags.workers) } : {}),
  })
  const tty = process.stderr.isTTY && !flags.json
  const audit = await auditPlugins(host, {
    targets,
    excludes: (flags.exclude ?? []).map(absolute),
    inventory,
    catalog,
    parser,
    onProgress: (done, total) => {
      if (tty) process.stderr.write(`\r\x1b[2K[${done}/${total}]`)
    },
  })
  await parser.close()
  if (tty) process.stderr.write('\r\x1b[2K')
  const run = await newRun('plugin-audit', false)
  const reportDir = flags.reportDir ? absolute(flags.reportDir) : run.dir
  mkdirSync(reportDir, { recursive: true })
  for (const [name, content] of auditReports(audit, inventory))
    writeFileSync(join(reportDir, name), content)
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
