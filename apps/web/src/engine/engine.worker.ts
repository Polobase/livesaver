/**
 * The engine's worker: one run per message (a scan, a fix, an undo), so the page stays
 * responsive while sets are read and written.
 */
import { type EngineScope, type ParseWorker, serveEngine } from '@livesaver/web'
import { browserState } from './storage.js'

// Older Safari cannot start a worker from a worker; sets are then parsed on this thread.
const spawn =
  typeof Worker === 'undefined'
    ? undefined
    : () =>
        new Worker(new URL('./parse.worker.ts', import.meta.url), {
          type: 'module',
        }) as unknown as ParseWorker

const storage = typeof navigator.storage?.getDirectory === 'function'
const locks = navigator.locks

serveEngine(self as unknown as EngineScope, {
  ...(spawn ? { spawn } : {}),
  cores: navigator.hardwareConcurrency || 4,
  ...(storage ? { state: browserState } : {}),
  // One run that writes at a time, whichever tab of the page it was started in: two would
  // write their journals and their sets across each other.
  ...(locks
    ? {
        exclusive: (work: () => Promise<void>) =>
          locks.request('livesaver-writes', { ifAvailable: true }, async (lock) => {
            if (!lock)
              throw new Error(
                'Another tab of this page is fixing or undoing right now. Wait until it has finished.',
              )
            await work()
          }),
      }
    : {}),
})
