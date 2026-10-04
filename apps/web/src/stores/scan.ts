/** A scan: running it, how far it is, what it found, and whether that is still what would be found. */
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { Scan, ScanRequest, Start } from '../engine/types.js'
import { requestKey } from '../lib/library.js'
import { advance, type RunProgress, starting } from '../lib/progress.js'
import { useEngineStore } from './engine.js'
import { useLibraryStore } from './library.js'

export const useScanStore = defineStore('scan', () => {
  const engines = useEngineStore()
  const library = useLibraryStore()
  const running = ref(false)
  const progress = ref<RunProgress>(starting('indexing'))
  /** The result is tens of thousands of rows that never change: nothing in it is watched. */
  const scan = shallowRef<Scan>()
  /** What was scanned: a fix does exactly that, whatever was changed on the page since. */
  const scanned = shallowRef<ScanRequest>()
  /** Why the last scan failed ('' = it did not). */
  const problem = ref('')

  /** The scan the engine kept from before the page was loaded. */
  function restore(last: Start['last']): void {
    if (!last) return
    scan.value = last.scan
    scanned.value = last.request
  }

  let current: Promise<boolean> | undefined

  /**
   * Scans what the library names now. Asked for while a scan runs, it follows that one: what was
   * written in between (a fix, an undo) is what the one that runs may not have seen.
   */
  async function run(): Promise<boolean> {
    while (current !== undefined) await current.catch(() => false)
    current = once().finally(() => {
      current = undefined
    })
    return current
  }

  /** Resolves once no scan runs: nothing may be written in the middle of one. */
  async function idle(): Promise<void> {
    while (current !== undefined) await current.catch(() => false)
  }

  async function once(): Promise<boolean> {
    const request = library.request
    running.value = true
    problem.value = ''
    progress.value = starting(engines.kind === 'browser' ? 'locating' : 'indexing')
    try {
      const found = await engines.engine().scan(request, (event) => {
        if (event.type === 'located')
          library.located = new Map(event.folders.map((folder) => [folder.id, folder]))
        progress.value = advance(progress.value, event)
      })
      scan.value = found
      scanned.value = request
      return true
    } catch (error) {
      problem.value = (error as Error).message
      return false
    } finally {
      running.value = false
    }
  }

  /**
   * Takes the files of installed libraries that their vendors re-saved: switches the rule for
   * them on and scans again. They then show as uncertain matches, which a review can leave out.
   */
  function acceptLibraryFiles(): Promise<boolean> {
    library.options = { ...library.options, matchLibraryPath: true }
    return run()
  }

  /** The folders or options were changed after the scan. */
  const stale = computed(
    () => scanned.value !== undefined && requestKey(scanned.value) !== requestKey(library.request),
  )

  return {
    running,
    progress,
    scan,
    scanned,
    problem,
    restore,
    run,
    idle,
    acceptLibraryFiles,
    stale,
  }
})
