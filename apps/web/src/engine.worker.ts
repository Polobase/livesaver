/** The engine worker: one run per message, so the page stays responsive while sets are checked. */
import type { ParseWorker } from '@livesaver/web'
import { run } from './engine.js'
import type { EngineEvent, FolderInput, ToEngine, WireFolder } from './protocol.js'

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ToEngine>) => void) | null
  postMessage(event: EngineEvent): void
}

// Older Safari cannot start a worker from a worker; sets are then parsed on this thread.
const spawn =
  typeof Worker === 'undefined'
    ? undefined
    : () =>
        new Worker(new URL('./parse.worker.js', import.meta.url), {
          type: 'module',
        }) as unknown as ParseWorker

/** Files of uploaded folders stay with the page; each is asked for when it is first read. */
const waiting = new Map<number, (file: File | undefined) => void>()
let requests = 0

function folder(wire: WireFolder): FolderInput {
  const { source } = wire
  if (source.kind === 'handle') return { ...wire, source }
  const open = (index: number) =>
    new Promise<File | undefined>((resolve) => {
      const request = requests++
      waiting.set(request, resolve)
      scope.postMessage({ type: 'open', request, folder: wire.id, index })
    })
  return { ...wire, source: { ...source, open } }
}

scope.onmessage = ({ data }) => {
  if (data.type === 'file') {
    waiting.get(data.request)?.(data.file)
    waiting.delete(data.request)
    return
  }
  void run(
    { projects: data.projects.map(folder), search: data.search.map(folder), options: data.options },
    (event) => scope.postMessage(event),
    { ...(spawn ? { spawn } : {}), cores: navigator.hardwareConcurrency || 4 },
  )
}
