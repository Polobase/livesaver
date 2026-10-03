/**
 * The engine on the calling thread, behind the interface of its worker: messages are copied as
 * `postMessage` copies them, so what could not travel to a real worker fails here too. For tests
 * outside a browser; a page uses a real worker, which keeps it responsive.
 */
import type { EngineWorker } from './client.js'
import type { FromEngine, ToEngine } from './protocol.js'
import { type EngineScope, type EngineWorkerOptions, serveEngine } from './worker.js'

export function localEngineWorker(options: EngineWorkerOptions = { cores: 1 }): EngineWorker {
  let stopped = false
  const scope: EngineScope = {
    onmessage: null,
    postMessage: (event: FromEngine) =>
      queueMicrotask(() => {
        if (!stopped) worker.onmessage?.({ data: structuredClone(event) } as MessageEvent)
      }),
  }
  serveEngine(scope, options)
  const worker: EngineWorker = {
    onmessage: null,
    onerror: null,
    postMessage: (message: ToEngine) =>
      queueMicrotask(() => {
        if (!stopped) scope.onmessage?.({ data: structuredClone(message) } as MessageEvent)
      }),
    terminate: () => {
      stopped = true
    },
  }
  return worker
}
