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
