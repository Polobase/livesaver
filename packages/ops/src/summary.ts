/** Console summary of a doctor/collect run. */
import { isComplete, type Project, type SetResult } from './collect.js'
import type { Status } from './match.js'
import { KIND_NAMES, libraryGroups, missingGroups } from './sources.js'

export function totalCounts(results: readonly SetResult[]): Record<Status, number> {
  const total: Record<Status, number> = {
    ok: 0,
    kept: 0,
    external: 0,
    found: 0,
    'not-found': 0,
    ambiguous: 0,
    mismatch: 0,
  }
  for (const r of results) for (const [k, v] of Object.entries(r.counts)) total[k as Status] += v
  return total
}

function pad(n: number, width: number): string {
  return String(n).padStart(width)
}

export function summary(
  results: readonly SetResult[],
  projects: readonly Project[],
  apply: boolean,
): string {
  const c = totalCounts(results)
  const errors = results.filter((r) => r.error)
  const changed = results.filter((r) => (apply ? r.written : r.changes.length > 0 && !r.error))
  const complete = results.filter(isComplete)
  const uncertain = results.reduce((n, r) => n + r.changes.filter((ch) => !ch.certain).length, 0)
  const files = projects.reduce((n, p) => n + p.copiedFiles, 0)
  const gigabytes = (projects.reduce((n, p) => n + p.copiedBytes, 0) / 1e9).toFixed(2)
  const skipped = results.filter((r) => r.skipped).length
  const refs = Object.values(c).reduce((a, b) => a + b, 0)
  const lines: string[] = []
  if (!apply) lines.push('DRY RUN – nothing was changed (to apply: --apply)')
  lines.push(
    `Projects: ${projects.length}   Sets: ${results.length}   complete: ${complete.length}` +
      (errors.length ? `   errors: ${errors.length}` : ''),
  )
  if (skipped) lines.push(`  skipped (unchanged and complete; --full checks all): ${skipped}`)
  lines.push(
    `Sample references (counted per set): ${refs}`,
    `  ok in project ............ ${c.ok}`,
    `  ok (pack/Live) ........... ${c.kept}`,
    `  external → collected ..... ${c.external}`,
    `  missing → repaired ....... ${c.found}  (uncertain: ${uncertain})`,
    `  not found ................ ${c['not-found']}`,
    `  ambiguous ................ ${c.ambiguous}`,
    `  different content ........ ${c.mismatch}`,
    `Copies: ${files} file${files === 1 ? '' : 's'} (${gigabytes} GB) ${apply ? 'copied' : 'would be copied'} into projects`,
    `Sets ${apply ? 'changed' : 'that would change'}: ${changed.length}`,
  )
  const libraries = libraryGroups(missingGroups(results))
  if (libraries.length > 0) {
    lines.push('Most common sources of missing samples:')
    for (const lib of libraries.slice(0, 15)) {
      lines.push(
        `  ${pad(lib.samples, 6)} samples in ${pad(lib.projects.size, 4)} projects  ${KIND_NAMES[lib.kind]}: ${lib.name}`,
      )
    }
  }
  for (const r of errors.slice(0, 10)) lines.push(`ERROR ${r.setPath}: ${r.error}`)
  return lines.join('\n')
}
