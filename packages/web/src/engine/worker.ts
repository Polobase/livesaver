/**
 * The worker side of a scan: one scan per message, so the page stays responsive while sets are
 * checked. The files of uploaded folders stay with the page; each is asked for when first read.
 */
import type { ParseWorker } from '../parser.js'
import type { FolderInput, FromEngine, ToEngine, WireFolder } from './protocol.js'
import { scanFolders } from './scan.js'

/** The part of a worker's global scope the engine needs. */
export interface EngineScope {
  onmessage: ((event: MessageEvent<ToEngine>) => void) | null
  postMessage(event: FromEngine): void
}

export interface EngineWorkerOptions {
  /** Starts a parse worker; left out where a worker cannot start workers (older Safari). */
  readonly spawn?: () => ParseWorker
  readonly cores: number
}

/** Run inside a worker: answers `scan` messages with the events of the scan. */
export function serveEngine(scope: EngineScope, options: EngineWorkerOptions): void {
  const waiting = new Map<number, (file: File | undefined) => void>()
  let requests = 0

  const folder = (wire: WireFolder): FolderInput => {
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
    void scanFolders(
      {
        projects: data.projects.map(folder),
        search: data.search.map(folder),
        options: data.options,
      },
      (event) => scope.postMessage(event),
      options,
    )
  }
}
