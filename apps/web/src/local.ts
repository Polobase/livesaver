/**
 * livesaver on this computer, as the page reaches it. When the page is served by `livesaver web`,
 * the computer itself reads the folders (by their paths, with nothing hidden from it) and can
 * write: so it can fix what a check finds. A page on its own can only read what it is given.
 */
import type { WebEvent, WebFixRequest, WebFolders, WebInfo, WebRequest, WebUndone } from 'livesaver'

/** The page was served by livesaver if its HTML carries a token (see `TOKEN_META` there). */
export function localToken(): string {
  return document.querySelector('meta[name="livesaver-local"]')?.getAttribute('content') ?? ''
}

async function failure(response: Response): Promise<Error> {
  try {
    const { message } = (await response.json()) as { message?: string }
    return new Error(message || `livesaver answered ${response.status}`)
  } catch {
    return new Error(`livesaver answered ${response.status}`)
  }
}

export class Local {
  private readonly headers: Record<string, string>

  constructor(token: string) {
    // The same name as `TOKEN_HEADER` of the server.
    this.headers = { 'x-livesaver-token': token, 'Content-Type': 'application/json' }
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(path, { headers: this.headers })
    if (!response.ok) throw await failure(response)
    return (await response.json()) as T
  }

  info(): Promise<WebInfo> {
    return this.get('/api/info')
  }

  async folders(path: string): Promise<WebFolders> {
    const answer = await this.get<WebFolders | { problem: string }>(
      `/api/folders?path=${encodeURIComponent(path)}`,
    )
    if ('problem' in answer) throw new Error(answer.problem)
    return answer
  }

  /** A run answers with one event per line, as it goes. */
  private async run(path: string, request: unknown, onEvent: (event: WebEvent) => void) {
    const response = await fetch(path, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(request),
    })
    if (!response.ok || !response.body) throw await failure(response)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let rest = ''
    for (;;) {
      const { done, value } = await reader.read()
      rest += decoder.decode(value, { stream: !done })
      const lines = rest.split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) if (line) onEvent(JSON.parse(line) as WebEvent)
      if (done) break
    }
    if (rest) onEvent(JSON.parse(rest) as WebEvent)
  }

  check(request: WebRequest, onEvent: (event: WebEvent) => void): Promise<void> {
    return this.run('/api/check', request, onEvent)
  }

  fix(request: WebFixRequest, onEvent: (event: WebEvent) => void): Promise<void> {
    return this.run('/api/fix', request, onEvent)
  }

  async undo(run: string): Promise<WebUndone> {
    const response = await fetch('/api/undo', {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ run }),
    })
    if (!response.ok) throw await failure(response)
    return (await response.json()) as WebUndone
  }
}
