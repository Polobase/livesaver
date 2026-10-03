/**
 * Fixing what a scan found: the review before anything is written, the fix, and taking it back.
 * A fix does what was scanned, not what the page shows since: it uses the scan's own request.
 */
import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import { type Fixed, RunFailed, type Status, type Undone } from '../engine/types.js'
import { type FixPlan, planOf } from '../lib/plan.js'
import { advance, type RunProgress, starting } from '../lib/progress.js'
import { useEngineStore } from './engine.js'
import { useHistoryStore } from './history.js'
import { useScanStore } from './scan.js'

/** What is to be fixed: every project, or the projects with these roots. */
export interface Review {
  readonly roots?: readonly string[]
  /** Leave the uncertain matches out. */
  certainOnly: boolean
}

export const useFixStore = defineStore('fix', () => {
  const engines = useEngineStore()
  const scans = useScanStore()
  const history = useHistoryStore()
  /** The fix that waits for a yes (the review is open while this is set). */
  const review = ref<Review>()
  const running = ref(false)
  const progress = ref<RunProgress>(starting('indexing'))
  const fixed = shallowRef<Fixed>()
  /** A fix that failed: why, and the run if it wrote something before (which can be undone). */
  const failure = ref<{ message: string; run: string }>()
  const undoing = computed(() => history.undoing !== '')
  const undone = shallowRef<Undone>()
  /** The newest fix that still stands: it can be undone, also after a reload. */
  const last = computed(() =>
    history.runs.find(
      (run) => run.command === 'collect' && run.state === 'applied' && run.sets + run.files > 0,
    ),
  )
  // A fix that was taken back elsewhere (in the history) is no longer a result to show.
  watch(
    () => history.runs,
    (runs) => {
      const run = runs.find((candidate) => candidate.id === fixed.value?.run)
      if (run?.state === 'undone' || run?.state === 'partly-undone') fixed.value = undefined
    },
  )
  /** Whether Live runs and how much room there is, asked when a review opens. */
  const status = shallowRef<Status>()

  const plan = computed<FixPlan | undefined>(() =>
    review.value && scans.scan
      ? planOf(scans.scan, review.value.roots, review.value.certainOnly)
      : undefined,
  )

  async function refreshStatus(): Promise<void> {
    const folder = scans.scanned?.projects[0]?.path
    try {
      status.value = await engines.engine().status(folder || undefined)
    } catch {
      status.value = undefined
    }
  }

  function open(roots?: readonly string[]): void {
    fixed.value = undefined
    failure.value = undefined
    undone.value = undefined
    review.value = { ...(roots ? { roots } : {}), certainOnly: false }
    void refreshStatus()
  }

  function close(): void {
    if (!running.value) review.value = undefined
  }

  async function apply(): Promise<boolean> {
    const request = scans.scanned
    const asked = review.value
    if (!request || !asked || running.value) return false
    running.value = true
    failure.value = undefined
    progress.value = starting('indexing')
    try {
      fixed.value = await engines.engine().fix(
        {
          ...request,
          ...(asked.roots ? { only: asked.roots } : {}),
          ...(asked.certainOnly ? { certainOnly: true } : {}),
        },
        (event) => {
          progress.value = advance(progress.value, event)
        },
      )
    } catch (error) {
      failure.value = {
        message: (error as Error).message,
        run: error instanceof RunFailed ? error.run : '',
      }
    } finally {
      running.value = false
    }
    await history.refresh()
    // What was found is still what there is, unless the fix got somewhere.
    if (fixed.value || failure.value?.run) await scans.run()
    return fixed.value !== undefined
  }

  async function undo(run: string): Promise<boolean> {
    if (undoing.value || running.value) return false
    failure.value = undefined
    try {
      undone.value = await history.undo(run)
      fixed.value = undefined
    } catch (error) {
      failure.value = { message: `The undo failed: ${(error as Error).message}`, run: '' }
    }
    await scans.run()
    return undone.value !== undefined
  }

  /** Forget what the last fix or undo said (the notice was read). */
  function dismiss(): void {
    fixed.value = undefined
    undone.value = undefined
    failure.value = undefined
  }

  return {
    review,
    plan,
    running,
    progress,
    fixed,
    failure,
    undoing,
    undone,
    last,
    status,
    open,
    close,
    apply,
    undo,
    dismiss,
    refreshStatus,
  }
})
