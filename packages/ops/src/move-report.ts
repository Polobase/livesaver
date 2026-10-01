/** Plan files and reports of `move` (`move_plan.csv`, the report and the summary). */
import { csvRecords, posix, pyFixed } from '@livesaver/core'
import type { Move, MoveSuggestion } from './move.js'
import { MOVE_TEXT as T } from './move-text.js'
import { formatSheet } from './sheet.js'

export function formatMovePlan(rows: readonly MoveSuggestion[]): string {
  return formatSheet(
    [...T.planColumns],
    rows.map((r) => [r.set, r.target, r.note]),
  )
}

/** Rows of a plan file grouped into (target, sets); `resolve` makes paths absolute (~ etc.). */
export function parseMovePlan(
  text: string,
  resolve: (path: string) => string,
): [string, string[]][] {
  const groups = new Map<string, string[]>()
  for (const r of csvRecords(text).records) {
    const set = r[T.planColumns[0]]
    const target = r[T.planColumns[1]]
    if (set && target) {
      const key = resolve(target)
      groups.set(key, [...(groups.get(key) ?? []), resolve(set)])
    }
  }
  return [...groups]
}

const mbText = (value: number) => pyFixed(value / 1e6, 1)

export function moveReport(moves: readonly Move[], base: string, apply: boolean): string {
  const rows: (string | number)[][] = []
  for (const m of moves) {
    const status = m.problems.length
      ? `${T.error}: ${m.problems.join(' | ')}`
      : m.done
        ? T.moved
        : T.planned
    for (const [old, next] of m.sets) {
      rows.push([
        posix.relpath(m.sourceRoot, base),
        posix.relpath(m.target, base),
        m.newProject ? T.newTarget : T.existingTarget,
        posix.basename(old),
        posix.basename(next),
        m.backups.length,
        m.copies.length,
        mbText(m.copyBytes),
        m.reused.length,
        m.unusedAfter.length,
        apply || m.problems.length ? status : T.planned,
      ])
    }
  }
  return formatSheet([...T.reportColumns], rows)
}

export function moveSummary(moves: readonly Move[], apply: boolean, base: string): string {
  const lines = [apply ? '' : 'DRY RUN – nothing was changed (to do it: --apply)']
  for (const m of moves) {
    const state = m.problems.length ? 'ERROR' : m.done ? T.moved : 'ready'
    const names = m.sets
      .map(([old, next]) =>
        old.endsWith(posix.basename(next))
          ? posix.basename(old)
          : `${posix.basename(old)} → ${posix.basename(next)}`,
      )
      .join(', ')
    lines.push(
      `[${state}] ${posix.relpath(m.sourceRoot, base)} → ${posix.relpath(m.target, base)}${m.newProject ? ' (new)' : ''}: ${names}`,
    )
    lines.push(
      `    ${m.backups.length} backups, ${m.copies.length} files to copy (${mbText(m.copyBytes)} MB), ${m.reused.length} already in the target, unused in the old project afterwards: ${m.unusedAfter.length}`,
    )
    lines.push(...m.problems.map((p) => `    ! ${p}`))
  }
  const ok = moves.filter((m) => !m.problems.length)
  const total = mbText(moves.reduce((sum, m) => sum + m.copyBytes, 0))
  const count = apply ? moves.filter((m) => m.done).length : ok.length
  lines.push(
    `Moves ${apply ? 'done' : 'ready'}: ${count} of ${moves.length}, copies ${total} MB in total`,
  )
  return lines.filter((l) => l).join('\n')
}
