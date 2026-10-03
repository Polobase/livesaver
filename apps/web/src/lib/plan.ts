/** What a fix would do: to every project, or to chosen ones, with the uncertain matches or without. */
import type { ProjectRow } from '@livesaver/ops'
import type { Scan } from '../engine/types.js'

export interface FixPlan {
  /** The projects a fix rewrites something in. */
  readonly projects: readonly ProjectRow[]
  readonly sets: number
  /** References that are rewritten. */
  readonly changes: number
  /** Of them, matches the fingerprint does not confirm (0 when they are left out). */
  readonly uncertain: number
  readonly copyFiles: number
  readonly copyBytes: number
  /** Samples that stay missing in these projects after the fix. */
  readonly missing: number
}

/**
 * The plan for the projects with these roots (none given: all), from one scan. Leaving the
 * uncertain matches out needs no second scan: the scan says for every project what a fix does
 * without them.
 */
export function planOf(
  scan: Scan,
  roots: readonly string[] | undefined,
  certainOnly: boolean,
): FixPlan {
  const chosen = roots ? new Set(roots) : undefined
  const rows = scan.samples.projectRows.filter((row) => !chosen || chosen.has(row.root))
  const of = (row: ProjectRow) =>
    certainOnly
      ? row.certain
      : {
          changingSets: row.changingSets,
          changes: row.changes,
          copyFiles: row.copyFiles,
          copyBytes: row.copyBytes,
        }
  const sum = (pick: (row: ProjectRow) => number) => rows.reduce((n, row) => n + pick(row), 0)
  return {
    projects: rows.filter((row) => of(row).changingSets > 0),
    sets: sum((row) => of(row).changingSets),
    changes: sum((row) => of(row).changes),
    uncertain: certainOnly ? 0 : sum((row) => row.uncertain),
    copyFiles: sum((row) => of(row).copyFiles),
    copyBytes: sum((row) => of(row).copyBytes),
    // What is left out as uncertain stays missing as well.
    missing: sum((row) => row.missing + (certainOnly ? row.changes - row.certain.changes : 0)),
  }
}

/** Room a fix needs beyond its copies: Live, the system and the backups need space too. */
export const FREE_SPACE_MARGIN = 512 * 1024 * 1024

/** Whether the copies of a plan fit where the projects lie (`undefined`: the space is not known). */
export function fits(plan: FixPlan, freeBytes: number | undefined): boolean | undefined {
  return freeBytes === undefined ? undefined : freeBytes >= plan.copyBytes + FREE_SPACE_MARGIN
}
