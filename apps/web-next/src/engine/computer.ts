/**
 * livesaver on this computer (`livesaver web`), reached over HTTP: it reads the folders by their
 * paths, with nothing hidden from it, and it can write: fix, upgrade, undo. A run answers with
 * one event per line and goes on when the page is closed.
 */
import type { UpgradeView } from '@livesaver/ops'
import type {
  WebEvent,
  WebFolders,
  WebInfo,
  WebLastScan,
  WebRequest,
  WebRunDetail,
  WebStatus,
  WebUndone,
} from 'livesaver'
import {
  type Capabilities,
  type Engine,
  type Fixed,
  type FixRequest,
  type FolderListing,
  type LibraryFolder,
  type OnProgress,
  type Run,
  type RunDetail,
  RunFailed,
  type Scan,
  type ScanRequest,
  type Start,
  type Status,
  type Undone,
  type Upgraded,
  type UpgradeRequest,
} from './types.js'

/** The header every request carries (`TOKEN_HEADER` of the server). */
const TOKEN_HEADER = 'x-livesaver-token'

/** The part of `fetch` the engine uses. */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export interface ComputerOptions {
  /** The token of the page livesaver served (see `localToken`). */
  readonly token: string
  /** Where livesaver answers; '' = where the page came from. */
  readonly base?: string
  readonly fetch?: Fetch
}

/** The page was served by livesaver if its HTML carries a token. */
export function localToken(page: Pick<Document, 'querySelector'>): string {
  return page.querySelector('meta[name="livesaver-local"]')?.getAttribute('content') ?? ''
}

const nameOf = (path: string) => path.split('/').filter(Boolean).pop() ?? path

/** A folder of this computer: its path is what names it. */
export function folderAt(path: string, vendor = false): LibraryFolder {
  return { id: path, name: nameOf(path), path, vendor }
}

const wire = (request: ScanRequest): WebRequest => ({
  projects: request.projects.map((folder) => folder.path),
  search: request.search.map(({ path, vendor }) => ({ path, vendor })),
  options: request.options,
})

const unwire = (request: WebRequest): ScanRequest => ({
  projects: request.projects.map((path) => folderAt(path)),
  search: request.search.map(({ path, vendor }) => folderAt(path, vendor)),
  options: request.options,
})

const scanOf = ({ scan, at }: Pick<WebLastScan, 'scan' | 'at'>): Scan => ({
  ...scan,
  at,
  folders: [],
})

export class ComputerEngine implements Engine {
  readonly kind = 'computer'
  capabilities: Capabilities = {
    paths: true,
    fix: true,
    upgrade: true,
    undo: true,
    history: true,
    // Known once livesaver said what its system can do (`start`).
    reveal: false,
    installedPlugins: true,
    liveStatus: true,
    keepsScan: true,
  }
  private readonly base: string
  private readonly headers: Record<string, string>
  private readonly fetch: Fetch

  constructor(options: ComputerOptions) {
    this.base = (options.base ?? '').replace(/\/$/, '')
    this.headers = { [TOKEN_HEADER]: options.token, 'Content-Type': 'application/json' }
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init))
  }

  private async answer(path: string, body?: unknown): Promise<Response> {
    let response: Response
    try {
      response = await this.fetch(`${this.base}${path}`, {
        headers: this.headers,
        ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
      })
    } catch {
      throw new RunFailed('livesaver on this computer does not answer. Start it again.')
    }
    if (response.ok) return response
    let message = `livesaver answered ${response.status}`
    try {
      message = ((await response.json()) as { message?: string }).message || message
    } catch {}
    throw new RunFailed(message)
  }

  private async json<T>(path: string, body?: unknown): Promise<T> {
    return (await (await this.answer(path, body)).json()) as T
  }

  /** A run: its events line by line as it goes; the last one says how it ended. */
  private async stream(path: string, body: unknown, onProgress?: OnProgress): Promise<WebEvent> {
    const response = await this.answer(path, body)
    if (!response.body) throw new RunFailed('livesaver gave no answer.')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let rest = ''
    let last: WebEvent | undefined
    const take = (line: string) => {
      if (!line) return
      const event = JSON.parse(line) as WebEvent
      last = event
      if (event.type === 'phase' || event.type === 'indexed' || event.type === 'progress')
        onProgress?.(event)
    }
    for (;;) {
      const { done, value } = await reader.read()
      rest += decoder.decode(value, { stream: !done })
      const lines = rest.split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) take(line)
      if (done) break
    }
    take(rest)
    const ended = last as WebEvent | undefined
    if (!ended) throw new RunFailed('It stopped unexpectedly.')
    if (ended.type === 'failed') throw new RunFailed(ended.message, ended.run)
    return ended
  }

  private ended<T extends WebEvent['type']>(
    event: WebEvent,
    type: T,
  ): Extract<WebEvent, { type: T }> {
    if (event.type !== type) throw new RunFailed('It stopped unexpectedly.')
    return event as Extract<WebEvent, { type: T }>
  }

  async start(): Promise<Start> {
    const info = await this.json<WebInfo>('/api/info')
    this.capabilities = { ...this.capabilities, reveal: Boolean(info.reveal) }
    const last = await this.json<Partial<WebLastScan>>('/api/scan')
    return {
      version: info.version,
      live: info.live,
      projects: info.projects.map((path) => folderAt(path)),
      search: info.search.map((folder) => ({ ...folderAt(folder.path, folder.vendor), ...folder })),
      options: info.options,
      suggested: info.suggested,
      places: info.places,
      home: info.home,
      upgradable: info.upgradable,
      ...(last.scan && last.request && last.at
        ? {
            last: {
              scan: scanOf({ scan: last.scan, at: last.at }),
              request: unwire(last.request),
              ...(last.upgrade ? { upgrade: last.upgrade } : {}),
            },
          }
        : {}),
    }
  }

  async scan(request: ScanRequest, onProgress?: OnProgress): Promise<Scan> {
    const event = await this.stream('/api/scan', wire(request), onProgress)
    return scanOf(this.ended(event, 'scanned'))
  }

  async planUpgrade(request: UpgradeRequest, onProgress?: OnProgress): Promise<UpgradeView> {
    const body = { ...request, projects: request.projects.map((folder) => folder.path) }
    return this.ended(await this.stream('/api/upgrade/plan', body, onProgress), 'planned').upgrade
  }

  async fix(request: FixRequest, onProgress?: OnProgress): Promise<Fixed> {
    const { only, certainOnly } = request
    const body = {
      ...wire(request),
      ...(only ? { only } : {}),
      ...(certainOnly ? { certainOnly } : {}),
    }
    return this.ended(await this.stream('/api/fix', body, onProgress), 'fixed').fixed
  }

  async upgrade(request: UpgradeRequest, onProgress?: OnProgress): Promise<Upgraded> {
    const body = { ...request, projects: request.projects.map((folder) => folder.path) }
    return this.ended(await this.stream('/api/upgrade', body, onProgress), 'upgraded').upgraded
  }

  undo(run: string): Promise<Undone> {
    return this.json<WebUndone>('/api/undo', { run })
  }

  runs(): Promise<readonly Run[]> {
    return this.json('/api/runs')
  }

  run(id: string): Promise<RunDetail> {
    return this.json<WebRunDetail>(`/api/runs/${encodeURIComponent(id)}`)
  }

  async report(run: string, name: string): Promise<string> {
    const path = `/api/runs/${encodeURIComponent(run)}/reports/${encodeURIComponent(name)}`
    return (await this.answer(path)).text()
  }

  async status(folder = ''): Promise<Status> {
    const query = folder ? `?path=${encodeURIComponent(folder)}` : ''
    const { lastScan: _lastScan, ...status } = await this.json<WebStatus>(`/api/status${query}`)
    return status
  }

  async reveal(path: string): Promise<void> {
    await this.json('/api/reveal', { path })
  }

  async folders(path: string): Promise<FolderListing> {
    const answer = await this.json<WebFolders | { problem: string }>(
      `/api/folders?path=${encodeURIComponent(path)}`,
    )
    if ('problem' in answer) throw new RunFailed(answer.problem)
    return answer
  }
}
