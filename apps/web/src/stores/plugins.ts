/**
 * Upgrading VST2 plug-ins to VST3: the plan (made when it is asked for: it reads sets again),
 * the review, the upgrade, and taking it back. An upgrade works on the folders that were
 * scanned, like a fix.
 */
import type { UpgradeView } from '@livesaver/ops'
import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import { type Run, RunFailed, type Status, type Undone, type Upgraded } from '../engine/types.js'
import { advance, type RunProgress, starting } from '../lib/progress.js'
import { useEngineStore } from './engine.js'
import { useScanStore } from './scan.js'

export const usePluginsStore = defineStore('plugins', () => {
  const engines = useEngineStore()
  const scans = useScanStore()
  /** What an upgrade would do, for the scan that is shown. */
  const plan = shallowRef<UpgradeView>()
  const planning = ref(false)
  const progress = ref<RunProgress>(starting('plugins'))
  /** Why the plan could not be made ('' = it could, or was not asked for). */
  const problem = ref('')
  /** The plug-ins that wait for a yes (the review is open while this is set). */
  const review = ref<{ plugins: readonly string[] }>()
  const running = ref(false)
  const upgraded = shallowRef<Upgraded>()
  const failure = ref<{ message: string; run: string }>()
  const undoing = ref(false)
  const undone = shallowRef<Undone>()
  /** The newest upgrade that still stands: it can be undone, also after a reload. */
  const last = shallowRef<Run>()
  const status = shallowRef<Status>()

  // A plan is of one scan: once the sets were scanned again, it has to be made again.
  watch(
    () => scans.scan,
    (scan, before) => {
      if (before !== undefined && scan !== before) plan.value = undefined
    },
  )

  const folders = computed(() => scans.scanned?.projects ?? [])

  async function loadPlan(): Promise<boolean> {
    if (planning.value || folders.value.length === 0) return false
    planning.value = true
    problem.value = ''
    progress.value = starting('plugins')
    const of = scans.scan
    try {
      const made = await engines.engine().planUpgrade({ projects: folders.value }, (event) => {
        progress.value = advance(progress.value, event)
      })
      // The sets were scanned again meanwhile: this plan is of what was there before.
      if (scans.scan === of) plan.value = made
      return true
    } catch (error) {
      problem.value = (error as Error).message
      return false
    } finally {
      planning.value = false
    }
  }

  /** The plan the engine kept with its scan, from before the page was loaded. */
  function restore(kept: UpgradeView | undefined): void {
    if (kept) plan.value = kept
  }

  /** The plug-ins of the plan that have something to convert. */
  const convertible = computed(() =>
    (plan.value?.plugins ?? []).filter((plugin) => plugin.convertibleSets > 0),
  )

  /** What the review is about: the chosen plug-ins of the plan. */
  const chosen = computed(() => {
    const names = new Set(review.value?.plugins ?? [])
    return convertible.value.filter((plugin) => names.has(plugin.plugin))
  })

  async function refreshStatus(): Promise<void> {
    try {
      status.value = await engines.engine().status()
    } catch {
      status.value = undefined
    }
  }

  function open(plugins: readonly string[]): void {
    upgraded.value = undefined
    failure.value = undefined
    undone.value = undefined
    review.value = { plugins }
    void refreshStatus()
  }

  function close(): void {
    if (!running.value) review.value = undefined
  }

  async function refreshLast(): Promise<void> {
    if (!engines.capabilities.history) return
    try {
      const runs = await engines.engine().runs()
      last.value = runs.find(
        (run) => run.command === 'vst3' && run.state === 'applied' && run.sets > 0,
      )
    } catch {
      last.value = undefined
    }
  }

  async function apply(): Promise<boolean> {
    const asked = review.value
    if (!asked || running.value || folders.value.length === 0) return false
    running.value = true
    failure.value = undefined
    progress.value = starting('upgrading')
    try {
      upgraded.value = await engines
        .engine()
        .upgrade({ projects: folders.value, plugins: asked.plugins }, (event) => {
          progress.value = advance(progress.value, event)
        })
    } catch (error) {
      failure.value = {
        message: (error as Error).message,
        run: error instanceof RunFailed ? error.run : '',
      }
    } finally {
      running.value = false
    }
    await refreshLast()
    if (upgraded.value || failure.value?.run) {
      await scans.run()
      await loadPlan()
    }
    return upgraded.value !== undefined
  }

  async function undo(run: string): Promise<boolean> {
    if (undoing.value || running.value) return false
    undoing.value = true
    failure.value = undefined
    try {
      undone.value = await engines.engine().undo(run)
      upgraded.value = undefined
    } catch (error) {
      failure.value = { message: `The undo failed: ${(error as Error).message}`, run: '' }
    } finally {
      undoing.value = false
    }
    await refreshLast()
    await scans.run()
    await loadPlan()
    return undone.value !== undefined
  }

  function dismiss(): void {
    upgraded.value = undefined
    undone.value = undefined
    failure.value = undefined
  }

  return {
    plan,
    planning,
    progress,
    problem,
    review,
    running,
    upgraded,
    failure,
    undoing,
    undone,
    last,
    status,
    convertible,
    chosen,
    loadPlan,
    restore,
    open,
    close,
    apply,
    undo,
    dismiss,
    refreshLast,
    refreshStatus,
  }
})
