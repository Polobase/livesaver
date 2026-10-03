/** The runs livesaver keeps: what each did, its steps and reports, and taking one back. */
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { Run, RunDetail, Undone } from '../engine/types.js'
import { useEngineStore } from './engine.js'
import { useScanStore } from './scan.js'

export const useHistoryStore = defineStore('history', () => {
  const engines = useEngineStore()
  const scans = useScanStore()
  /** Every run, the newest first (none before the first look, or where there is no history). */
  const runs = shallowRef<readonly Run[]>([])
  const loaded = ref(false)
  const problem = ref('')
  /** The run that is being undone right now, from whichever screen: one undo at a time. */
  const undoing = ref('')
  /** What the last undo from the history did. */
  const undone = shallowRef<{ run: string; result: Undone }>()

  async function refresh(): Promise<void> {
    if (!engines.capabilities.history) return
    try {
      runs.value = await engines.engine().runs()
      problem.value = ''
    } catch (error) {
      problem.value = `The history could not be read: ${(error as Error).message}`
    } finally {
      loaded.value = true
    }
  }

  function detail(id: string): Promise<RunDetail> {
    return engines.engine().run(id)
  }

  function report(id: string, name: string): Promise<string> {
    return engines.engine().report(id, name)
  }

  /**
   * Takes a run back, whatever kind it was. Rejects if it could not; the list of runs is renewed
   * either way, since an undo that failed may have taken back a part.
   */
  async function undo(id: string): Promise<Undone> {
    if (undoing.value) throw new Error('Another undo is still running.')
    undoing.value = id
    try {
      // A scan that still runs (the one after a fix) is waited for: livesaver does one thing
      // at a time.
      await scans.idle()
      return await engines.engine().undo(id)
    } finally {
      await refresh()
      undoing.value = ''
    }
  }

  /** An undo from the history: says what it did, and looks at the library again. */
  async function takeBack(id: string): Promise<boolean> {
    undone.value = undefined
    let failure = ''
    try {
      undone.value = { run: id, result: await undo(id) }
    } catch (error) {
      failure = `The undo failed: ${(error as Error).message}`
    }
    if (failure) problem.value = failure
    // What was scanned is no longer what is there.
    if (scans.scanned) await scans.run()
    return undone.value !== undefined
  }

  /** Nothing can be taken back while something else reads or writes the library. */
  const busy = computed(() => undoing.value !== '' || scans.running)

  return { runs, loaded, problem, undoing, undone, busy, refresh, detail, report, undo, takeBack }
})
