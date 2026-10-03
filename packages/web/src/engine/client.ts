/**
 * The page side of a scan: sends the folders to the engine's worker, hands it the files it asks
 * for, and passes on what it reports.
 */
import type {
  BrowserScan,
  FolderInput,
  FromEngine,
  ScanEvent,
  ScanRequest,
  ToEngine,
  WireFolder,
} from './protocol.js'

/** The part of a `Worker` the client uses. */
export interface EngineWorker {
  onmessage: ((event: MessageEvent<FromEngine>) => unknown) | null
  onerror: ((event: { readonly message?: string }) => unknown) | null
  postMessage(message: ToEngine): void
  terminate(): void
}

/** A folder as it travels to the engine: an upload as the paths of its files, without the files. */
export function wireFolder(folder: FolderInput): WireFolder {
  const { source } = folder
  if (source.kind === 'handle') return { ...folder, source }
  const paths = source.kind === 'files' ? source.files.map((f) => f.path) : source.paths
  return { ...folder, source: { kind: 'listing', name: source.name, paths } }
}

export interface RunningScan {
  /** Settles with the scan; rejects with what the page should show if it failed or was stopped. */
  readonly result: Promise<BrowserScan>
  stop(): void
}

/**
 * Scan in a worker of its own, which is given up afterwards: its memory (every set that was
 * read) goes with it.
 */
export function scanInWorker(
  spawn: () => EngineWorker,
  request: ScanRequest,
  onEvent: (event: ScanEvent) => void,
): RunningScan {
  const worker = spawn()
  const folders = [...request.projects, ...request.search]
  let stop = () => {}
  const result = new Promise<BrowserScan>((resolve, reject) => {
    stop = () => {
      worker.terminate()
      reject(new Error('The scan was stopped.'))
    }
    worker.onmessage = ({ data }) => {
      if (data.type === 'open') {
        // The files of a folder stay here; the engine gets each one when it reads it.
        const source = folders.find((f) => f.id === data.folder)?.source
        const reply = (file: File | undefined) =>
          worker.postMessage({ type: 'file', request: data.request, file })
        if (source?.kind === 'listing')
          void source.open(data.index).then(reply, () => reply(undefined))
        else reply(source?.kind === 'files' ? source.files[data.index]?.file : undefined)
        return
      }
      onEvent(data)
      if (data.type !== 'scanned' && data.type !== 'failed') return
      worker.terminate()
      if (data.type === 'scanned') resolve(data.scan)
      else reject(new Error(data.message))
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message || 'The scan stopped unexpectedly.'))
    }
    worker.postMessage({
      type: 'scan',
      projects: request.projects.map(wireFolder),
      search: request.search.map(wireFolder),
      options: request.options,
    })
  })
  return { result, stop: () => stop() }
}
