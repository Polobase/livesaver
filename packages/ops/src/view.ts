/**
 * The result of a check shaped for a user interface: the headline numbers, and one row per
 * project, set, missing sample and planned change. The report files say the same in CSV and
 * Markdown; this is for a page that shows it.
 */
import { posix } from '@livesaver/core'
import { type Action, isComplete, type SetResult } from './collect.js'
import type { DoctorResult } from './doctor.js'
import type { Environment } from './env.js'
import { MISSING_STATES, type Status } from './match.js'
import {
  FOUND_NAMES,
  foundSources,
  HINTS,
  KIND_NAMES,
  libraryGroups,
  missingGroups,
} from './sources.js'
import { totalCounts } from './summary.js'

export interface SourceRow {
  readonly kind: string
  readonly name: string
  readonly samples: number
  readonly projects: number
  /** What to do about it (sources of missing samples only). */
  readonly hint: string
}

/** What a fix does when uncertain matches are left out (`certainOnly`). */
export interface CertainPlan {
  readonly changingSets: number
  readonly changes: number
  readonly copyFiles: number
  readonly copyBytes: number
}

export interface ProjectRow {
  /** The project folder (absolute), which is what a fix of one project is given. */
  readonly root: string
  /** Relative to the common folder of the targets. */
  readonly path: string
  readonly sets: number
  readonly completeSets: number
  /** Sets that a fix rewrites. */
  readonly changingSets: number
  /** References a fix repairs or collects, and how many of them are uncertain matches. */
  readonly changes: number
  readonly uncertain: number
  /** References that stay missing after a fix. */
  readonly missing: number
  readonly copyFiles: number
  readonly copyBytes: number
  readonly certain: CertainPlan
  /** Sets that could not be read. */
  readonly errors: number
}

export interface SetRow {
  /** Relative to the common folder of the targets. */
  readonly path: string
  readonly project: string
  readonly name: string
  readonly live: string
  readonly counts: Readonly<Record<Status, number>>
  readonly changes: number
  readonly error: string
}

export interface MissingRow {
  readonly status: Status
  readonly device: boolean
  readonly name: string
  readonly path: string
  readonly source: string
  readonly size: number
  readonly sets: number
  readonly projects: number
  readonly candidates: readonly string[]
}

export interface ChangeRow {
  readonly project: string
  readonly set: string
  readonly action: Action
  readonly name: string
  readonly oldPath: string
  readonly newPath: string
  readonly source: string
  readonly method: string
  readonly certain: boolean
}

export interface CheckView {
  /** Common folder of the targets; paths in the rows are relative to it. */
  readonly base: string
  readonly seconds: number
  readonly indexedFiles: number
  readonly projects: number
  readonly completeProjects: number
  readonly sets: number
  readonly completeSets: number
  readonly counts: Readonly<Record<Status, number>>
  readonly uncertain: number
  readonly copyFiles: number
  readonly copyBytes: number
  readonly changingSets: number
  readonly certain: CertainPlan
  readonly missingSources: readonly SourceRow[]
  readonly foundSources: readonly SourceRow[]
  readonly projectRows: readonly ProjectRow[]
  readonly setRows: readonly SetRow[]
  readonly missing: readonly MissingRow[]
  readonly changes: readonly ChangeRow[]
}

const changes = (set: SetResult) => (set.error ? 0 : set.changes.length)

/**
 * The changes of a set that remain without uncertain matches. Paths are only brought up to date
 * in a set that is rewritten anyway, so a set whose every repair is uncertain is left as it is.
 */
function certainChanges(set: SetResult): number {
  if (set.error) return 0
  const rewritten = set.changes.some((c) => c.certain && c.action !== 'path-updated')
  return rewritten ? set.changes.filter((c) => c.certain).length : 0
}

export function checkView(r: DoctorResult, env: Environment): CheckView {
  const rel = (path: string) => {
    const relative = posix.relpath(path, r.base)
    return relative === '.' ? posix.basename(path) : relative
  }
  const groups = missingGroups(r.results)
  const copies = new Map(r.projects.map((p) => [p.root, p]))
  const byProject = new Map<string, SetResult[]>()
  for (const set of r.results) {
    const sets = byProject.get(set.projectRoot)
    if (sets) sets.push(set)
    else byProject.set(set.projectRoot, [set])
  }
  const projectRows = [...byProject].map(([root, sets]): ProjectRow => {
    const sum = (count: (set: SetResult) => number) => sets.reduce((n, set) => n + count(set), 0)
    return {
      root,
      path: rel(root),
      sets: sets.length,
      completeSets: sets.filter(isComplete).length,
      changingSets: sets.filter((set) => changes(set) > 0).length,
      changes: sum(changes),
      uncertain: sum((set) => (set.error ? 0 : set.changes.filter((c) => !c.certain).length)),
      missing: sum((set) => MISSING_STATES.reduce((n, status) => n + set.counts[status], 0)),
      copyFiles: copies.get(root)?.copiedFiles ?? 0,
      copyBytes: copies.get(root)?.copiedBytes ?? 0,
      certain: {
        changingSets: sets.filter((set) => certainChanges(set) > 0).length,
        changes: sum(certainChanges),
        copyFiles: copies.get(root)?.certainCopies.files ?? 0,
        copyBytes: copies.get(root)?.certainCopies.bytes ?? 0,
      },
      errors: sets.filter((set) => set.error).length,
    }
  })
  const total = (count: (plan: CertainPlan) => number) =>
    projectRows.reduce((n, project) => n + count(project.certain), 0)
  return {
    base: r.base,
    seconds: r.ms / 1000,
    indexedFiles: r.index.fileCount,
    projects: projectRows.length,
    completeProjects: projectRows.filter((p) => p.completeSets === p.sets).length,
    sets: r.results.length,
    completeSets: r.results.filter(isComplete).length,
    counts: totalCounts(r.results),
    // As the summary of the command line counts them: over every planned change.
    uncertain: r.results.reduce((n, s) => n + s.changes.filter((c) => !c.certain).length, 0),
    copyFiles: r.projects.reduce((n, p) => n + p.copiedFiles, 0),
    copyBytes: r.projects.reduce((n, p) => n + p.copiedBytes, 0),
    changingSets: projectRows.reduce((n, p) => n + p.changingSets, 0),
    certain: {
      changingSets: total((plan) => plan.changingSets),
      changes: total((plan) => plan.changes),
      copyFiles: total((plan) => plan.copyFiles),
      copyBytes: total((plan) => plan.copyBytes),
    },
    missingSources: libraryGroups(groups).map((lib) => ({
      kind: KIND_NAMES[lib.kind],
      name: lib.name,
      samples: lib.samples,
      projects: lib.projects.size,
      hint: HINTS[lib.kind],
    })),
    foundSources: foundSources(r.results, env, r.index.roots).map((f) => ({
      kind: FOUND_NAMES[f.kind],
      name: f.name,
      samples: f.files.size,
      projects: f.projects.size,
      hint: '',
    })),
    projectRows,
    setRows: r.results.map((s) => ({
      path: rel(s.setPath),
      project: rel(s.projectRoot),
      name: posix.basename(s.setPath),
      live: s.creator.replace('Ableton Live ', ''),
      counts: s.counts,
      changes: s.changes.length,
      error: s.error,
    })),
    missing: groups.map((g) => ({
      status: g.status,
      device: g.kind === 'device',
      name: g.name,
      path: g.path,
      source: g.source,
      size: g.size,
      sets: g.sets.size,
      projects: g.projects.size,
      candidates: g.choice.candidates.slice(0, 10),
    })),
    changes: r.results.flatMap((s) =>
      s.changes.map((c) => ({
        project: rel(s.projectRoot),
        set: posix.basename(s.setPath),
        action: c.action,
        name: c.name,
        oldPath: c.oldPath,
        newPath: c.newPath,
        source: c.source,
        method: c.method,
        certain: c.certain,
      })),
    ),
  }
}
