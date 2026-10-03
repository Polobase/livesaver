/** What both ways of running the page share: the options, the progress of a run, its result. */
import type { ComponentChildren } from 'preact'
import { FixBar } from './fix.js'
import { count, INSTALLED, plural } from './format.js'
import { HealthIcon } from './icons.js'
import type { Phase, ProjectRow, RunOptions, RunResult } from './protocol.js'
import { References, Reports, RunFacts, Sources, Tiles } from './results.js'
import { Details } from './tables.js'

export type RunState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'running'
      readonly phase: Phase
      readonly done: number
      readonly total: number
      readonly name: string
      readonly files: number
    }
  | { readonly kind: 'done'; readonly result: RunResult }
  | { readonly kind: 'failed'; readonly message: string }

export type Running = Extract<RunState, { kind: 'running' }>

export const starting = (phase: Phase): Running => ({
  kind: 'running',
  phase,
  done: 0,
  total: 0,
  name: '',
  files: 0,
})

const PHASE: Record<Phase, string> = {
  locating: 'Finding out where the folders lie on disk',
  indexing: 'Listing audio files and Max devices',
  checking: 'Checking sets',
  fixing: 'Fixing sets',
  reporting: 'Writing the report',
}

export function Progress({ run }: { run: Running }) {
  const counting = (run.phase === 'checking' || run.phase === 'fixing') && run.total > 0
  return (
    <div class="progress" role="status" aria-live="polite">
      <div class="progress-label">
        <span>
          {PHASE[run.phase]}
          {counting ? `: ${count(run.done)} of ${count(run.total)}` : '…'}
        </span>
        <span class="hint">
          {counting ? run.name : run.files ? `${count(run.files)} files listed` : ''}
        </span>
      </div>
      {counting ? <progress max={run.total} value={run.done} /> : <progress />}
    </div>
  )
}

interface OptionsProps {
  readonly options: RunOptions
  readonly disabled: boolean
  readonly onChange: (options: RunOptions) => void
  /** Said under the library option while it is on (e.g. that no folder is marked for it). */
  readonly libraryNote?: ComponentChildren
}

export function Options({ options, disabled, onChange, libraryNote }: OptionsProps) {
  return (
    <div class="options">
      <label class="check">
        <input
          type="checkbox"
          checked={options.matchLibraryPath}
          disabled={disabled}
          autocomplete="off"
          onChange={(event) =>
            onChange({ ...options, matchLibraryPath: event.currentTarget.checked })
          }
        />
        Also accept a library file with another fingerprint when its name and place in the library
        match (marked uncertain)
      </label>
      {options.matchLibraryPath && libraryNote}
      <label class="field">
        Keep pack files larger than
        <input
          type="number"
          min="0"
          step="1"
          value={options.packLimitMB}
          disabled={disabled}
          autocomplete="off"
          onInput={(event) =>
            onChange({
              ...options,
              packLimitMB: Math.max(0, Number(event.currentTarget.value) || 0),
            })
          }
        />
        MB in their pack
      </label>
    </div>
  )
}

/** Said at the library option while no sample folder is marked as holding installed libraries. */
export function NoLibraryMarked() {
  return (
    <p class="hint option-note" role="note">
      None of your sample folders is marked "{INSTALLED}", so this only applies to Ableton's packs.
      Tick it on the folder that holds your libraries (Native Instruments installs them in{' '}
      <code>/Users/Shared</code>).
    </p>
  )
}

interface ResultsProps {
  readonly result: RunResult
  /** How to get Live's own content into the check, said when it is missing. */
  readonly liveAdvice: string
  /** Fix everything, or one project: only where livesaver runs on this computer. */
  readonly onFix?: (project?: ProjectRow) => void
  /** The folders or options were changed after this check. */
  readonly stale?: boolean
}

export function Results({ result, liveAdvice, onFix, stale }: ResultsProps) {
  if (result.sets === 0)
    return (
      <section class="card">
        <h2>No Live Sets found</h2>
        <p class="hint">
          There is no <code>.als</code> file in the project folders (backup folders are not
          checked).
        </p>
      </section>
    )
  return (
    <>
      {!result.ableton.coreLibrary && (
        <p class="callout" role="note">
          <HealthIcon health="missing" />
          <span>
            Live's own content was not among the folders: samples of Live's Core Library cannot be
            found, and content that Live moved between versions is not recognised. {liveAdvice}
          </span>
        </p>
      )}
      {(result.unreadable?.length ?? 0) > 0 && (
        <p class="callout" role="note">
          <HealthIcon health="missing" />
          <span>
            {plural(result.unreadable?.length ?? 0, 'folder')} could not be read (permissions or
            privacy settings), for example {result.unreadable?.[0]}. Samples in there were not seen.
          </span>
        </p>
      )}
      <Tiles result={result} />
      {onFix && <FixBar result={result} onFix={() => onFix()} stale={stale ?? false} />}
      <References counts={result.counts} />
      <div class="columns">
        <Sources
          title="Most common sources of missing samples"
          empty="No samples are missing."
          rows={result.missingSources}
        />
        <Sources
          title="Most common sources of found samples"
          empty="No missing sample was found in the given folders."
          rows={result.foundSources}
        />
      </div>
      <Details result={result} {...(onFix ? { onFix } : {})} />
      <Reports reports={result.reports} />
      <RunFacts result={result} />
    </>
  )
}
