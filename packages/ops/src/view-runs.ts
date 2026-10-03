/**
 * A run as plain data, for `livesaver runs` and for a page that shows the history: what its
 * journal says it did, and what of that was taken back since.
 */
import type { BeginEntry, JournalEntry } from './apply.js'

/**
 * `dry-run`: nothing was to be written. `nothing`: it was to write, and there was nothing to do.
 * `partly-undone`: some of it still stands (e.g. a copied file another set uses by now).
 */
export type RunState = 'dry-run' | 'nothing' | 'applied' | 'partly-undone' | 'undone'

/** What a run was asked to do, and how it ended (`run.json` in its folder). */
export interface RunRecord {
  readonly version: 1
  readonly command: string
  readonly apply: boolean
  /** The folders, sets or plan it was given. */
  readonly targets: readonly string[]
  /** The options that shaped it, named as on the command line. */
  readonly options: Readonly<Record<string, unknown>>
  readonly started: string
  /** Left out while it runs, and for good if it was killed. */
  readonly ended?: string
  /** The numbers it ended with, by name. */
  readonly outcome?: Readonly<Record<string, number>>
  readonly error?: string
}

export interface RunSummary {
  readonly id: string
  /** When it started, local time, as its folder is named: `2026-10-03 14:30:05` ('' = unknown). */
  readonly when: string
  /** `collect`, `vst3`, `status`, `reorg`, `move`, `run-<codemod>`, … */
  readonly command: string
  readonly applied: boolean
  readonly state: RunState
  readonly sets: number
  /** Samples and Max devices copied into projects. */
  readonly files: number
  readonly renames: number
  readonly tags: number
  readonly comments: number
  /** Files of livesaver's own that it replaced (the rating sheet). */
  readonly ownFiles: number
  /** Steps that began and never ended: the run was killed there. */
  readonly unfinished: number
  /** `undo` has something left to take back. */
  readonly canUndo: boolean
  readonly record?: RunRecord
}

export interface RunStep {
  readonly op: BeginEntry['op']
  /** The set, the copy, the new place of what was moved, or the tagged or commented paths. */
  readonly path: string
  /** A copy's source, or where a moved file or folder was. */
  readonly from: string
  /** The backup of a rewritten set in its project. */
  readonly backup: string
  readonly at: string
  readonly finished: boolean
  /** '' while it stands; else how it ended: `restored`, `trashed`, `renamed-back`, `changed-since`. */
  readonly undone: string
}

const ID = /^(\d{4}-\d\d-\d\d)_(\d\d)(\d\d)(\d\d)_(.+)_(apply|dry-run)(?:-\d+)?$/

/** The parts of a run folder's name. */
export function parseRunId(id: string): { when: string; command: string; applied: boolean } {
  const m = ID.exec(id)
  if (!m) return { when: '', command: id, applied: false }
  return {
    when: `${m[1]} ${m[2]}:${m[3]}:${m[4]}`,
    command: m[5] as string,
    applied: m[6] === 'apply',
  }
}

const timeOf = (entry: JournalEntry) => (entry as { at?: string }).at ?? ''

/** Every step of a run in the order it happened, with what became of it. */
export function runSteps(entries: readonly JournalEntry[]): RunStep[] {
  const ended = new Set(entries.filter((e) => e.t === 'end').map((e) => e.id))
  const undone = new Map<number, string>()
  for (const e of entries) if (e.t === 'undo') undone.set(e.id, e.result)
  return entries
    .filter((e): e is BeginEntry => e.t === 'begin')
    .map((e) => {
      const place =
        e.op === 'copy'
          ? { path: e.destination, from: e.source }
          : e.op === 'write-set'
            ? { path: e.set, from: '' }
            : e.op === 'rename'
              ? { path: e.to, from: e.from }
              : e.op === 'comments'
                ? { path: e.items.map((item) => item.path).join('\n'), from: '' }
                : { path: e.path, from: '' }
      return {
        op: e.op,
        ...place,
        backup: e.op === 'write-set' ? e.backup : '',
        at: timeOf(e),
        finished: ended.has(e.id),
        undone: undone.get(e.id) ?? '',
      }
    })
}

export function runSummary(
  id: string,
  entries: readonly JournalEntry[],
  record?: RunRecord,
): RunSummary {
  const { when, command, applied } = parseRunId(id)
  const steps = runSteps(entries)
  const finished = steps.filter((step) => step.finished)
  const count = (op: RunStep['op']) => finished.filter((step) => step.op === op).length
  const standing = finished.filter((step) => !step.undone).length
  const state: RunState =
    entries.length === 0
      ? applied
        ? 'nothing'
        : 'dry-run'
      : finished.length === 0
        ? 'nothing'
        : standing === finished.length
          ? 'applied'
          : standing === 0
            ? 'undone'
            : 'partly-undone'
  return {
    id,
    when,
    command: record?.command ?? command,
    applied: record?.apply ?? (applied || entries.length > 0),
    state,
    sets: count('write-set'),
    files: count('copy'),
    renames: count('rename'),
    tags: count('tags'),
    comments: entries.reduce(
      (n, e) => n + (e.t === 'begin' && e.op === 'comments' ? e.items.length : 0),
      0,
    ),
    ownFiles: count('replace-file'),
    unfinished: steps.length - finished.length,
    canUndo: standing > 0,
    ...(record ? { record } : {}),
  }
}

/** What a run did, in a few words: `3 sets written, 12 files copied`. */
export function runText(run: RunSummary): string {
  if (run.state === 'dry-run') return 'dry run'
  const plural = (n: number, one: string, many: string) => (n ? `${n} ${n === 1 ? one : many}` : '')
  const done = [
    plural(run.sets, 'set written', 'sets written'),
    plural(run.files, 'file copied', 'files copied'),
    plural(run.renames, 'moved', 'moved'),
    plural(run.tags, 'tag set', 'tags set'),
    plural(run.comments, 'comment set', 'comments set'),
    plural(run.ownFiles, 'file of livesaver replaced', 'files of livesaver replaced'),
  ].filter((part) => part)
  return done.join(', ') || 'nothing changed'
}
