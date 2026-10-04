/**
 * The engine on the calling thread, behind the interface of its worker: messages are copied as
 * `postMessage` copies them, so what could not travel to a real worker fails here too. For tests
 * outside a browser; a page uses a real worker, which keeps it responsive.
 */
import type { DirectoryHandleLike } from '../source.js'
import type { EngineWorker } from './client.js'
import type { FromEngine, ToEngine, WireFolder } from './protocol.js'
import { type EngineScope, type EngineWorkerOptions, serveEngine } from './worker.js'

/**
 * A request as the worker gets it. A folder handle arrives as a handle of the same folder: a
 * browser's own are made to travel, the stand-ins of a test are not, so they are passed on as
 * they are.
 */
function sent(message: ToEngine): ToEngine {
  if (message.type === 'file') return structuredClone(message)
  const handles = new Map<string, DirectoryHandleLike>()
  const without = (folder: WireFolder): WireFolder => {
    if (folder.source.kind !== 'handle') return folder
    handles.set(folder.id, folder.source.handle)
    return { ...folder, source: { ...folder.source, handle: undefined as never } }
  }
  const copy = structuredClone({
    ...message,
    projects: message.projects.map(without),
    search: message.search.map(without),
    ...(message.installed ? { installed: message.installed.map(without) } : {}),
  })
  const withHandle = (folder: WireFolder): WireFolder => {
    const handle = handles.get(folder.id)
    return handle && folder.source.kind === 'handle'
      ? { ...folder, source: { ...folder.source, handle } }
      : folder
  }
  return {
    ...copy,
    projects: copy.projects.map(withHandle),
    search: copy.search.map(withHandle),
    ...(copy.installed ? { installed: copy.installed.map(withHandle) } : {}),
  }
}

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
        if (!stopped) scope.onmessage?.({ data: sent(message) } as MessageEvent)
      }),
    terminate: () => {
      stopped = true
    },
  }
  return worker
}
