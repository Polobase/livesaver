/** The engine's worker: one scan per message, so the page stays responsive while sets are read. */
import { type EngineScope, type ParseWorker, serveEngine } from '@livesaver/web'

// Older Safari cannot start a worker from a worker; sets are then parsed on this thread.
const spawn =
  typeof Worker === 'undefined'
    ? undefined
    : () =>
        new Worker(new URL('./parse.worker.ts', import.meta.url), {
          type: 'module',
        }) as unknown as ParseWorker

serveEngine(self as unknown as EngineScope, {
  ...(spawn ? { spawn } : {}),
  cores: navigator.hardwareConcurrency || 4,
})
