/**
 * VST2 → VST3 over folders of sets. Writing goes through the same writer as collect: backup,
 * journal, atomic replace, so `livesaver undo` reverses it too.
 */
import { encodeDocument, type FileStat, type Host, inProcessParser, posix } from '@livesaver/core'
import {
  type Catalog,
  convertText,
  KNOWN,
  type Known,
  type PluginOutcome,
  reasonsText,
} from '@livesaver/plugins'
import { DRY_RUN, findSets, projectRootOf, type Writer } from './collect.js'
import { Probe } from './probe.js'
import { toCsv } from './reports.js'

export interface SetUpgrade {
  readonly setPath: string
  readonly projectRoot: string
  creator: string
  plugins: PluginOutcome[]
  unchecked: ReadonlyMap<string, number>
  changed: boolean
  written: boolean
  backup: string
  error: string
}

export interface UpgradeOptions {
  readonly targets: readonly string[]
  readonly excludes?: readonly string[]
  readonly catalog: Catalog
  readonly known?: ReadonlyMap<number, Known>
  /** Only these plug-ins (names, any case). */
  readonly only?: readonly string[]
  readonly writer?: Writer
  readonly probe?: Probe
  readonly onSet?: (result: SetUpgrade, index: number, total: number) => void
}

function sameFile(a: FileStat, b: FileStat): boolean {
  return a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.ino === b.ino
}

export async function upgradePlugins(
  host: Host,
  options: UpgradeOptions,
): Promise<{ results: SetUpgrade[]; base: string; ms: number }> {
  const started = performance.now()
  const probe = options.probe ?? new Probe(host.fs, host.hash)
  const writer = options.writer ?? DRY_RUN
  const parser = inProcessParser(host)
  const only = options.only?.length ? new Set(options.only.map((p) => p.toLowerCase())) : undefined
  let base = posix.commonpath(options.targets)
  if (await probe.isFile(base)) base = posix.dirname(base)
  const sets = await findSets(options.targets, options.excludes ?? [], probe)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const results: SetUpgrade[] = []
  for (const [i, setPath] of sets.entries()) {
    const root = await projectRootOf(setPath, probe)
    const result: SetUpgrade = {
      setPath,
      projectRoot: root,
      creator: '',
      plugins: [],
      unchecked: new Map(),
      changed: false,
      written: false,
      backup: '',
      error: '',
    }
    results.push(result)
    const parsed = await parser.parse(setPath)
    if (!parsed.ok) {
      result.error = parsed.error
      options.onSet?.(result, i + 1, sets.length)
      continue
    }
    result.creator = parsed.doc.creator
    try {
      const converted = convertText(decoder.decode(parsed.doc.xml), options.catalog, {
        known: options.known ?? KNOWN,
        ...(only ? { only } : {}),
      })
      result.plugins = converted.outcomes
      result.unchecked = converted.unchecked
      result.changed = converted.text !== undefined
      if (converted.text !== undefined && writer.apply) {
        const data = await encodeDocument(
          parsed.doc,
          new TextEncoder().encode(converted.text),
          host.codec,
        )
        const now = await host.fs.stat(setPath)
        if (parsed.stat && (!now || !sameFile(now, parsed.stat))) {
          throw new Error('the set changed after it was read (is Live saving it?); not written')
        }
        result.backup = await writer.writeSet(setPath, root, data)
        result.written = true
      }
    } catch (error) {
      result.error = (error as Error).message
    }
    options.onSet?.(result, i + 1, sets.length)
  }
  return { results, base, ms: performance.now() - started }
}

export const UPGRADE_REPORT = 'vst3_upgrade.csv'

/** The per-plug-in report. */
export function upgradeReport(results: readonly SetUpgrade[], base: string): string {
  const rows: (string | number)[][] = [
    [
      'Project',
      'Set',
      'Live version',
      'Plug-in',
      'Instances',
      'Converted',
      'Reason',
      'Parameter selection reset',
      'Backup',
      'Error',
    ],
  ]
  for (const r of results) {
    const project = posix.relpath(r.projectRoot, base)
    const name = posix.relpath(r.setPath, r.projectRoot)
    const version = r.creator.replace('Ableton Live ', '')
    if (r.error) rows.push([project, name, version, '', '', 'no', '', '', '', r.error])
    for (const p of r.plugins) {
      rows.push([
        project,
        name,
        version,
        p.plugin,
        p.instances,
        p.converted ? 'yes' : 'no',
        reasonsText(p.reasons),
        p.selectionsReset || '',
        r.backup,
        r.error,
      ])
    }
  }
  return toCsv(rows)
}

/** Console summary. */
export function upgradeSummary(results: readonly SetUpgrade[], apply: boolean): string {
  const lines: string[] = []
  if (!apply) lines.push('DRY RUN – nothing was changed (to apply: --apply)')
  const totals = new Map<
    string,
    {
      sets: number
      setsOk: number
      inst: number
      instOk: number
      reasons: Map<string, number>
      resets: number
    }
  >()
  for (const r of results) {
    for (const p of r.plugins) {
      const t = totals.get(p.plugin) ?? {
        sets: 0,
        setsOk: 0,
        inst: 0,
        instOk: 0,
        reasons: new Map(),
        resets: 0,
      }
      totals.set(p.plugin, t)
      t.sets++
      t.inst += p.instances
      if (p.converted) {
        t.setsOk++
        t.instOk += p.instances
        t.resets += p.selectionsReset
      }
      for (const [k, n] of p.reasons) t.reasons.set(k, (t.reasons.get(k) ?? 0) + n)
    }
  }
  for (const [plugin, t] of [...totals].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    lines.push(
      `${plugin}: ${apply ? 'converted' : 'convertible'} in ${t.setsOk} of ${t.sets} sets (${t.instOk} of ${t.inst} instances)`,
    )
    if (t.reasons.size)
      lines.push(
        `  not converted (all or nothing per set): ${reasonsText(t.reasons as Map<never, number>)}`,
      )
    if (t.resets) lines.push(`  custom parameter selection reset: ${t.resets} instances`)
  }
  const changed = results.filter((r) => r.changed && !r.error)
  lines.push(
    apply
      ? `Sets changed: ${changed.length} (backups in <project>/Backup)`
      : `Sets that would change: ${changed.length}`,
  )
  const unchecked = new Map<string, number>()
  for (const r of results)
    for (const [n, c] of r.unchecked) unchecked.set(n, (unchecked.get(n) ?? 0) + c)
  if (unchecked.size) {
    const list = [...unchecked]
      .sort((a, b) => b[1] - a[1])
      .map(([n, c]) => `${n} ×${c}`)
      .join(', ')
    lines.push(`Other VST2 plug-ins with an installed VST3 (not verified, stay VST2): ${list}`)
  }
  for (const r of results) if (r.error) lines.push(`ERROR ${r.setPath}: ${r.error}`)
  return lines.join('\n')
}
