/**
 * The rating sheet (a CSV file, e.g. `Ratings.csv`): one row per project; people type a decision,
 * stars and a note into it.
 *
 * `status --apply` first takes over what was typed into the sheet (as Finder tags, and the note in
 * the folder's comment), then writes the sheet anew with the current state. A cell counts as typed
 * when it differs from what the last run wrote (remembered in a snapshot); otherwise Finder wins, so
 * a tag set in Finder is not undone by an old sheet. Rows are found by group + project (relative to
 * the sheet's folder); a project that moved since is found by its folder name if that is unique.
 *
 * Spreadsheet programs may save the file with "," or ";" and with or without byte order mark; all
 * of these are read.
 */
import {
  type CsvValue,
  csvRecords,
  formatCsv,
  nfc,
  norm,
  posix,
  pyStrip,
  sniffDelimiter,
} from '@livesaver/core'

/** The cells people edit. */
export type Editable = 'decision' | 'stars' | 'note'
export const EDITABLE: readonly Editable[] = ['decision', 'stars', 'note']
export type Cells = Record<Editable, string>

/** Column names of the key and the editable columns. */
export const SHEET_COLUMNS: Record<'group' | 'project' | Editable, string> = {
  group: 'Group',
  project: 'Project',
  decision: 'Decision',
  stars: 'Stars',
  note: 'Note',
}

export const SNAPSHOT_VERSION = 1

function clean(text: string | undefined): string {
  return pyStrip(nfc(text ?? ''))
}

/** `Group/Project`, or just the project when it sits directly in the sheet's folder. */
export function keyOf(group: string, project: string): string {
  return group && group !== '.' ? posix.join(group, project) : project
}

function column(record: Record<string, string | undefined>, field: 'group' | 'project' | Editable) {
  return record[SHEET_COLUMNS[field]]
}

/** The cells of every project row ("Group/Project" → cells) of a sheet's text. */
export function readSheet(text: string): Map<string, Cells> {
  const body = text.startsWith('\ufeff') ? text.slice(1) : text
  const { records } = csvRecords(body, sniffDelimiter(body))
  const rows = new Map<string, Cells>()
  for (const record of records) {
    const project = clean(column(record, 'project'))
    if (!project) continue
    rows.set(keyOf(clean(column(record, 'group')), project), {
      decision: clean(column(record, 'decision')),
      stars: clean(column(record, 'stars')),
      note: clean(column(record, 'note')),
    })
  }
  return rows
}

/** LibreOffice keeps a lock file next to a document it has open. */
export function lockFileOf(path: string): string {
  return posix.join(posix.dirname(path), `.~lock.${posix.basename(path)}#`)
}

/** The rows of a snapshot file; empty if unreadable or another version. */
export function parseSnapshot(json: string | undefined): Map<string, Cells> {
  const rows = new Map<string, Cells>()
  try {
    const data = JSON.parse(json ?? '') as {
      version?: number
      rows?: Record<string, Partial<Cells>>
    }
    if (data.version !== SNAPSHOT_VERSION || !data.rows) return rows
    for (const [key, cells] of Object.entries(data.rows)) {
      rows.set(key, {
        decision: cells.decision ?? '',
        stars: cells.stars ?? '',
        note: cells.note ?? '',
      })
    }
  } catch {}
  return rows
}

export function serializeSnapshot(rows: ReadonlyMap<string, Cells>): string {
  const out: Record<string, Cells> = {}
  for (const [key, cells] of rows) {
    out[key] = { decision: cells.decision, stars: cells.stars, note: cells.note }
  }
  return JSON.stringify({ version: SNAPSHOT_VERSION, rows: out })
}

/** Cells that were changed in the sheet since the last run wrote it. */
export function typedCells(
  sheet: ReadonlyMap<string, Cells>,
  snapshot: ReadonlyMap<string, Cells>,
): Map<string, Partial<Cells>> {
  const before = new Map<string, Cells>()
  for (const [key, cells] of snapshot) before.set(norm(key), cells)
  const changed = new Map<string, Partial<Cells>>()
  for (const [key, cells] of sheet) {
    const old = before.get(norm(key))
    const diff: Partial<Cells> = {}
    for (const field of EDITABLE) {
      const v = cells[field]
      if (old ? v !== old[field] : v) diff[field] = v
    }
    if (Object.keys(diff).length) changed.set(key, diff)
  }
  return changed
}

/** Case and accents ignored, so "cafe" matches a decision named "Café". */
function fold(text: string): string {
  return norm(text).normalize('NFD').replace(/\p{M}/gu, '')
}

/** A decision, also abbreviated ("c", "cont", "del"); '' for none, `undefined` if unclear. */
export function parseDecision(text: string, decisions: readonly string[]): string | undefined {
  const wanted = fold(text)
  if (!wanted) return ''
  const hits = decisions.filter((d) => fold(d).startsWith(wanted))
  return hits.length === 1 ? hits[0] : undefined
}

/** "3", "3★", "***" or "3 stars" → "3★"; '' for none, `undefined` if unclear. */
export function parseStars(text: string): string | undefined {
  const t = pyStrip(text)
  if (!t) return ''
  if (/^[★*]{1,5}$/.test(t)) return `${[...t].length}★`
  const m = /^([1-5])(?:[.,]0+)?\s*(?:★|\*|stars?)?$/i.exec(t)
  return m ? `${m[1]}★` : undefined
}

/** The sheet file's content (UTF-8 with byte order mark, so Excel reads it as UTF-8). */
export function formatSheet(
  header: readonly string[],
  rows: readonly (readonly CsvValue[])[],
): string {
  return formatCsv([header, ...rows])
}
