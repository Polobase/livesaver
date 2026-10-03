/** Fixing what a check found: the button, the question before it happens, and what it did. */
import type { WebFixed, WebLastFix, WebUndone } from 'livesaver'
import { useEffect, useRef } from 'preact/hooks'
import { bytes, count, plural } from './format.js'
import { HealthIcon } from './icons.js'
import type { ProjectRow, RunResult } from './protocol.js'

/** What a fix would do, to everything or to one project. */
export interface FixPlan {
  /** The one project, as the page names it (none: every project). */
  readonly project?: ProjectRow
  readonly projects: number
  readonly sets: number
  readonly changes: number
  readonly uncertain: number
  readonly copyFiles: number
  readonly copyBytes: number
}

export function planOf(result: RunResult, project?: ProjectRow): FixPlan {
  if (project)
    return {
      project,
      projects: 1,
      sets: project.changingSets,
      changes: project.changes,
      uncertain: project.uncertain,
      copyFiles: project.copyFiles,
      copyBytes: project.copyBytes,
    }
  const fixable = result.projectRows.filter((p) => p.changingSets > 0)
  return {
    projects: fixable.length,
    sets: result.changingSets,
    changes: fixable.reduce((n, p) => n + p.changes, 0),
    uncertain: fixable.reduce((n, p) => n + p.uncertain, 0),
    copyFiles: result.copyFiles,
    copyBytes: result.copyBytes,
  }
}

const copies = (plan: FixPlan) =>
  plan.copyFiles ? `${plural(plan.copyFiles, 'file')} (${bytes(plan.copyBytes)})` : 'no files'

interface FixBarProps {
  readonly result: RunResult
  readonly onFix: () => void
  /** The folders or options were changed after the check: a fix does what this check found. */
  readonly stale: boolean
}

export function FixBar({ result, onFix, stale }: FixBarProps) {
  const plan = planOf(result)
  if (plan.sets === 0) return null
  return (
    <section class="card fix-bar" aria-label="Fix">
      <div>
        <h2>
          {plural(plan.sets, 'set')} in {plural(plan.projects, 'project')} can be fixed
        </h2>
        <p class="hint">
          Like Live's "Collect All and Save": {copies(plan)} to copy into the projects,{' '}
          {plural(plan.changes, 'reference')} to rewrite. The set as it was stays in the Backup
          folder of its project, and a fix can be undone.
        </p>
        {stale && (
          <p class="hint stale" role="note">
            You changed folders or options after this check. A fix does what this check found; check
            again to see what it would do with the changes.
          </p>
        )}
      </div>
      <button type="button" class="primary" onClick={onFix}>
        Fix all
      </button>
    </section>
  )
}

interface ConfirmProps {
  readonly plan: FixPlan
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

export function ConfirmFix({ plan, onConfirm, onCancel }: ConfirmProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  const what = plan.project ? `"${plan.project.path}"` : plural(plan.projects, 'project')
  return (
    <dialog ref={dialog} class="dialog" aria-labelledby="confirm-title" onClose={onCancel}>
      <h2 id="confirm-title">Fix {what}?</h2>
      <ul>
        <li>
          {plural(plan.sets, 'set')} {plan.sets === 1 ? 'is' : 'are'} rewritten. The set as it was
          is kept in the Backup folder of its project.
        </li>
        <li>
          {plan.copyFiles
            ? `${copies(plan)} ${plan.copyFiles === 1 ? 'is' : 'are'} copied into ${plan.projects === 1 ? 'the project' : 'the projects'}.`
            : 'No file is copied.'}
        </li>
        {plan.uncertain > 0 && (
          <li>
            {count(plan.uncertain)} of the {plural(plan.changes, 'change')}{' '}
            {plan.uncertain === 1 ? 'is' : 'are'} uncertain: the file was not confirmed by its
            fingerprint. They are marked under "Planned changes".
          </li>
        )}
        <li>Ableton Live must not be running.</li>
      </ul>
      <p class="hint">You can undo the fix afterwards.</p>
      <div class="dialog-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" class="primary" onClick={onConfirm}>
          Fix {plural(plan.sets, 'set')}
        </button>
      </div>
    </dialog>
  )
}

/** What the last fix or undo did, or why it did not happen. */
export type Note =
  | { readonly kind: 'fixed'; readonly what: string; readonly fixed: WebFixed }
  /** `earlier`: the fix before the undone one, which can be undone as well. */
  | { readonly kind: 'undone'; readonly undone: WebUndone; readonly earlier?: WebLastFix }
  /** A fix from before the page was loaded. */
  | { readonly kind: 'earlier'; readonly last: WebLastFix }
  /** `run`: a fix that failed on its way; what it did until then can be undone. */
  | { readonly kind: 'problem'; readonly message: string; readonly run?: string }

function List({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null
  return (
    <>
      <p>{title}</p>
      <ul>
        {items.slice(0, 5).map((item) => (
          <li key={item}>{item}</li>
        ))}
        {items.length > 5 && <li>and {count(items.length - 5)} more</li>}
      </ul>
    </>
  )
}

interface NoteProps {
  readonly note: Note
  readonly busy: boolean
  readonly onUndo: (run: string) => void
}

export function FixNote({ note, busy, onUndo }: NoteProps) {
  if (note.kind === 'problem') {
    const { run } = note
    return (
      <div class="callout" role="alert">
        <HealthIcon health="missing" />
        <div class="note-text">
          <p>{note.message}</p>
        </div>
        {run && (
          <button type="button" disabled={busy} onClick={() => onUndo(run)}>
            Undo what it did
          </button>
        )}
      </div>
    )
  }
  if (note.kind === 'earlier') {
    const { last } = note
    return (
      <div class="callout" role="status">
        <HealthIcon health="fine" />
        <div class="note-text">
          <p>
            The last fix, on {last.when}, rewrote {plural(last.sets, 'set')} and copied{' '}
            {plural(last.files, 'file')}.
          </p>
        </div>
        <button type="button" disabled={busy} onClick={() => onUndo(last.run)}>
          Undo this fix
        </button>
      </div>
    )
  }
  if (note.kind === 'undone') {
    const { undone, earlier } = note
    return (
      <div class="callout" role="status">
        <HealthIcon health="fine" />
        <div class="note-text">
          <p>
            Undone: {plural(undone.restored, 'set')} restored, {plural(undone.trashed, 'file')}{' '}
            moved to the Trash
            {undone.kept ? `, ${plural(undone.kept, 'file')} kept (used by a set by now)` : ''}.
          </p>
          <List title="Changed since the fix, and left alone:" items={undone.changedSince} />
          <List title="Problems:" items={undone.problems} />
        </div>
        {earlier && (
          <button type="button" disabled={busy} onClick={() => onUndo(earlier.run)}>
            Undo the fix before it ({earlier.when})
          </button>
        )}
      </div>
    )
  }
  const { fixed } = note
  return (
    <div class="callout" role="status">
      <HealthIcon health={fixed.errors.length ? 'missing' : 'fine'} />
      <div class="note-text">
        <p>
          Fixed {note.what}: {plural(fixed.sets, 'set')} rewritten, {plural(fixed.files, 'file')}{' '}
          copied ({bytes(fixed.bytes)}).
        </p>
        <List
          title="Not written:"
          items={fixed.errors.map(({ set, error }) => `${set}: ${error}`)}
        />
      </div>
      {fixed.run && (
        <button type="button" disabled={busy} onClick={() => onUndo(fixed.run)}>
          Undo this fix
        </button>
      )}
    </div>
  )
}
