/** What a scan says about one project, or about one of its sets: its sets, changes and gaps. */
import type { ChangeRow, MissingRow, ProjectRow, SetRow, SourceRow } from '@livesaver/ops'
import type { Scan } from '../engine/types.js'

export interface ProjectDetail {
  readonly project: ProjectRow
  /** The one set that is looked at, if the detail is narrowed to it. */
  readonly set?: SetRow
  readonly sets: readonly SetRow[]
  readonly changes: readonly ChangeRow[]
  readonly missing: readonly MissingRow[]
}

export function projectDetail(
  scan: Scan,
  root: string,
  setPath?: string,
): ProjectDetail | undefined {
  const { samples } = scan
  const project = samples.projectRows.find((row) => row.root === root)
  if (!project) return undefined
  const all = samples.setRows.filter((row) => row.project === project.path)
  const set = setPath ? all.find((row) => row.path === setPath) : undefined
  const sets = set ? [set] : all
  const paths = new Set(sets.map((row) => row.path))
  return {
    project,
    ...(set ? { set } : {}),
    sets,
    changes: samples.changes.filter((row) => paths.has(row.setPath)),
    missing: samples.missing.filter((row) => row.usedBy.some((path) => paths.has(path))),
  }
}

/**
 * Sets of a project that an older Live saved than its newest set, and that are not complete:
 * old saves, kept beside newer ones of the same song. A scan can leave such sets out.
 * `live`: the oldest Live among them; `newest`: the Live of the project's newest save.
 */
export function olderSaves(
  sets: readonly SetRow[],
): { readonly sets: number; readonly live: number; readonly newest: number } | undefined {
  const major = (row: SetRow) => Number.parseInt(row.live, 10) || 0
  const newest = Math.max(0, ...sets.map(major))
  const incomplete = (row: SetRow) =>
    row.error !== '' ||
    row.changes > 0 ||
    row.counts['not-found'] + row.counts.ambiguous + row.counts.mismatch > 0
  const old = sets.filter((row) => major(row) > 0 && major(row) < newest && incomplete(row))
  return old.length ? { sets: old.length, live: Math.min(...old.map(major)), newest } : undefined
}

/** The project of a set, by the set's row. */
export function projectOf(scan: Scan, set: SetRow): ProjectRow | undefined {
  return scan.samples.projectRows.find((row) => row.path === set.project)
}

export interface MissingGroup {
  readonly source: SourceRow
  readonly rows: readonly MissingRow[]
}

/** The missing samples under the source they are counted with, the largest source first. */
export function missingGroups(scan: Scan, keep: (row: MissingRow) => boolean): MissingGroup[] {
  const key = (kind: string, name: string) => `${kind}\u0000${name}`
  const bySource = new Map<string, MissingRow[]>()
  for (const row of scan.samples.missing) {
    if (!keep(row)) continue
    const at = key(row.sourceKind, row.sourceName)
    const rows = bySource.get(at)
    if (rows) rows.push(row)
    else bySource.set(at, [row])
  }
  return scan.samples.missingSources
    .map((source) => ({ source, rows: bySource.get(key(source.kind, source.name)) ?? [] }))
    .filter((group) => group.rows.length > 0)
}

/** Missing samples as lines to paste elsewhere: name, where it was, where it came from. */
export function missingAsText(rows: readonly MissingRow[]): string {
  return rows.map((row) => [row.name, row.path, row.sourceName].join('\t')).join('\n')
}
