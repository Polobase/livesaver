/**
 * The worker side of the engine: one run per message (a scan, a fix, an undo), so the page stays
 * responsive while sets are read and written. The files of uploaded folders stay with the page;
 * each is asked for when first read.
 */
import type { ParseWorker } from '../parser.js'
import { fixFolders, type StateFolder, undoFolders, type WriteEngineOptions } from './fix.js'
import type {
  FolderInput,
  FromEngine,
  ToEngine,
  WireFolder,
  WireRequest,
  WireUpgrade,
} from './protocol.js'
import { scanFolders } from './scan.js'
import { planUpgradeFolders, upgradeFolders } from './upgrade.js'

/** The part of a worker's global scope the engine needs. */
export interface EngineScope {
  onmessage: ((event: MessageEvent<ToEngine>) => void) | null
  postMessage(event: FromEngine): void
}

export interface EngineWorkerOptions {
  /** Starts a parse worker; left out where a worker cannot start workers (older Safari). */
  readonly spawn?: () => ParseWorker
  readonly cores: number
  /** The page's own storage, for the runs of a fix; without it the engine only reads. */
  readonly state?: StateFolder
  /** See `WriteEngineOptions`. */
  readonly exclusive?: WriteEngineOptions['exclusive']
}

/** Run inside a worker: answers each request with the events of its run. */
export function serveEngine(scope: EngineScope, options: EngineWorkerOptions): void {
  const waiting = new Map<number, (file: File | undefined) => void>()
  let requests = 0

  const folder = (wire: WireFolder): FolderInput => {
    const { source } = wire
    const open = (index: number) =>
      new Promise<File | undefined>((resolve) => {
        const request = requests++
        waiting.set(request, resolve)
        scope.postMessage({ type: 'open', request, folder: wire.id, index })
      })
    if (source.kind === 'listing') return { ...wire, source: { ...source, open } }
    // (Of a folder behind a handle, the files the handle hides are asked for the same way.)
    const { kind, name, handle, hidden } = source
    return {
      ...wire,
      source: { kind, name, handle, ...(hidden ? { hidden: { paths: hidden.paths, open } } : {}) },
    }
  }
  const folders = (wire: WireRequest) => ({
    projects: wire.projects.map(folder),
    search: wire.search.map(folder),
    ...(wire.installed ? { installed: wire.installed.map(folder) } : {}),
    options: wire.options,
    ...(wire.windows === undefined ? {} : { windows: wire.windows }),
  })
  const emit = (event: FromEngine) => scope.postMessage(event)

  scope.onmessage = ({ data }) => {
    if (data.type === 'file') {
      waiting.get(data.request)?.(data.file)
      waiting.delete(data.request)
      return
    }
    if (data.type === 'scan') {
      void scanFolders(folders(data), emit, options)
      return
    }
    const upgrade = (wire: WireUpgrade) => ({
      ...folders(wire),
      ...(wire.names ? { names: wire.names } : {}),
      ...(wire.only ? { only: wire.only } : {}),
    })
    // A plan only reads.
    if (data.type === 'plan-upgrade') {
      void planUpgradeFolders(upgrade(data), emit, options)
      return
    }
    const { state } = options
    if (!state) {
      emit({ type: 'failed', message: 'This page has no storage of its own to keep an undo in.' })
      return
    }
    const writing = { ...options, state }
    if (data.type === 'fix')
      void fixFolders(
        {
          ...folders(data),
          ...(data.only ? { only: data.only } : {}),
          ...(data.certainOnly ? { certainOnly: true } : {}),
        },
        emit,
        writing,
      )
    else if (data.type === 'upgrade') void upgradeFolders(upgrade(data), emit, writing)
    else void undoFolders({ ...folders(data), run: data.run }, emit, writing)
  }
}
