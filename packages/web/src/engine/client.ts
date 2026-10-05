/**
 * The page side of the engine: sends the folders of a request to the engine's worker, hands it
 * the files it asks for, and passes on what it reports.
 */
import type { UpgradeView } from '@livesaver/ops'
import type {
  BrowserFixed,
  BrowserScan,
  BrowserUndone,
  BrowserUpgraded,
  FixEvent,
  FixRequest,
  FolderInput,
  FromEngine,
  ScanEvent,
  ScanRequest,
  ToEngine,
  UndoRequest,
  UpgradeEvent,
  UpgradeRequest,
  WireFolder,
  WireRequest,
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
  if (source.kind === 'handle') {
    const { kind, name, handle, hidden } = source
    return {
      ...folder,
      source: { kind, name, handle, ...(hidden ? { hidden: { paths: hidden.paths } } : {}) },
    }
  }
  const paths = source.kind === 'files' ? source.files.map((f) => f.path) : source.paths
  return { ...folder, source: { kind: 'listing', name: source.name, paths } }
}

const wireRequest = (request: ScanRequest): WireRequest => ({
  projects: request.projects.map(wireFolder),
  search: request.search.map(wireFolder),
  ...(request.installed ? { installed: request.installed.map(wireFolder) } : {}),
  options: request.options,
  ...(request.windows === undefined ? {} : { windows: request.windows }),
})

/** A run that failed. `run`: it wrote something before it failed, which can be undone. */
export class EngineFailure extends Error {
  readonly run: string

  constructor(message: string, run = '') {
    super(message)
    this.name = 'EngineFailure'
    this.run = run
  }
}

type Outcome<T> = { readonly value: T } | undefined

/**
 * One run in a worker of its own, which is given up afterwards: its memory (every set that was
 * read) goes with it. `done` says what an event ends the run with, if it does.
 */
function runInWorker<T>(
  spawn: () => EngineWorker,
  request: ScanRequest,
  message: ToEngine,
  what: string,
  done: (event: FromEngine) => Outcome<T>,
): { result: Promise<T>; stop: () => void } {
  const worker = spawn()
  const folders = [...request.projects, ...request.search, ...(request.installed ?? [])]
  let stop = () => {}
  const result = new Promise<T>((resolve, reject) => {
    stop = () => {
      worker.terminate()
      reject(new Error(`The ${what} was stopped.`))
    }
    worker.onmessage = ({ data }) => {
      if (data.type === 'open') {
        // The files of a folder stay here; the engine gets each one when it reads it.
        const source = folders.find((f) => f.id === data.folder)?.source
        const reply = (file: File | undefined) =>
          worker.postMessage({ type: 'file', request: data.request, file })
        // (Of a folder behind a handle: one of the files the handle hides.)
        const listed =
          source?.kind === 'listing'
            ? source
            : source?.kind === 'handle'
              ? source.hidden
              : undefined
        if (listed) void listed.open(data.index).then(reply, () => reply(undefined))
        else reply(source?.kind === 'files' ? source.files[data.index]?.file : undefined)
        return
      }
      // A failure is an event like the others to whoever listens, and the end of the run.
      const outcome = done(data)
      if (data.type === 'failed') {
        worker.terminate()
        reject(new EngineFailure(data.message, 'run' in data ? data.run : ''))
      } else if (outcome) {
        worker.terminate()
        resolve(outcome.value)
      }
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message || `The ${what} stopped unexpectedly.`))
    }
    worker.postMessage(message)
  })
  return { result, stop: () => stop() }
}

export interface RunningScan {
  /** Settles with the scan; rejects with what the page should show if it failed or was stopped. */
  readonly result: Promise<BrowserScan>
  stop(): void
}

/** A scan in a worker of its own. */
export function scanInWorker(
  spawn: () => EngineWorker,
  request: ScanRequest,
  onEvent: (event: ScanEvent) => void,
): RunningScan {
  return runInWorker(spawn, request, { type: 'scan', ...wireRequest(request) }, 'scan', (event) => {
    onEvent(event as ScanEvent)
    return event.type === 'scanned' ? { value: event.scan } : undefined
  })
}

/**
 * A fix in a worker of its own. It cannot be stopped: what it began, it ends. Rejects with an
 * `EngineFailure`, which names the run if something was written before it failed.
 */
export function fixInWorker(
  spawn: () => EngineWorker,
  request: FixRequest,
  onEvent: (event: FixEvent) => void,
): Promise<BrowserFixed> {
  const message: ToEngine = {
    type: 'fix',
    ...wireRequest(request),
    ...(request.only ? { only: request.only } : {}),
    ...(request.certainOnly ? { certainOnly: true } : {}),
  }
  return runInWorker(spawn, request, message, 'fix', (event) => {
    onEvent(event as FixEvent)
    return event.type === 'fixed' ? { value: event.fixed } : undefined
  }).result
}

/** An undo in a worker of its own. */
export function undoInWorker(
  spawn: () => EngineWorker,
  request: UndoRequest,
): Promise<BrowserUndone> {
  const message: ToEngine = { type: 'undo', ...wireRequest(request), run: request.run }
  return runInWorker(spawn, request, message, 'undo', (event) =>
    event.type === 'undone' ? { value: event.undone } : undefined,
  ).result
}

const upgradeMessage = (type: 'plan-upgrade' | 'upgrade', request: UpgradeRequest): ToEngine => ({
  type,
  ...wireRequest(request),
  ...(request.names ? { names: request.names } : {}),
  ...(request.only ? { only: request.only } : {}),
})

/** What an upgrade of VST2 plug-ins to VST3 would do, planned in a worker of its own. */
export function planUpgradeInWorker(
  spawn: () => EngineWorker,
  request: UpgradeRequest,
  onEvent: (event: UpgradeEvent) => void,
): Promise<UpgradeView> {
  return runInWorker(spawn, request, upgradeMessage('plan-upgrade', request), 'plan', (event) => {
    onEvent(event as UpgradeEvent)
    return event.type === 'planned' ? { value: event.upgrade } : undefined
  }).result
}

/** The upgrade, in a worker of its own. Like a fix, it cannot be stopped. */
export function upgradeInWorker(
  spawn: () => EngineWorker,
  request: UpgradeRequest,
  onEvent: (event: UpgradeEvent) => void,
): Promise<BrowserUpgraded> {
  return runInWorker(spawn, request, upgradeMessage('upgrade', request), 'upgrade', (event) => {
    onEvent(event as UpgradeEvent)
    return event.type === 'upgraded' ? { value: event.upgraded } : undefined
  }).result
}
