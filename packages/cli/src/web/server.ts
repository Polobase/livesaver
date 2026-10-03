/**
 * The web app served from this computer: the page's files, and what the page asks of livesaver
 * (`local.ts`). It listens on this computer only, and since it can write, every request must
 * carry the token of the page it served: no other page in the browser can ask it for anything.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type WebSettings, webCheck, webFix, webFolders, webInfo, webUndo } from './local.js'
import {
  TOKEN_HEADER,
  TOKEN_META,
  type WebEvent,
  type WebFixRequest,
  type WebRequest,
} from './protocol.js'

export interface WebServerOptions extends WebSettings {
  /** 0 = any free port. */
  readonly port?: number
  /** The folder with the built page; found next to this file if not given. `false`: no page. */
  readonly assets?: string | false
  /**
   * Other addresses a page may come from, e.g. `http://localhost:5174` when a development
   * server serves the page and passes its requests on. They need the token all the same.
   */
  readonly origins?: readonly string[]
  /** Called before the page is served, e.g. to rebuild it after a change. */
  readonly beforePage?: () => Promise<void>
}

export interface WebServer {
  readonly url: string
  readonly port: number
  /** The token the served page carries (for tests that talk to the server themselves). */
  readonly token: string
  close(): Promise<void>
}

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
}

/** The built page: shipped with the package, or in the repository when run from source. */
export function findAssets(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const places = [
    join(here, '..', 'web-app'),
    join(here, '..', '..', '..', '..', 'apps', 'web', 'dist'),
  ]
  const found = places.find((place) => existsSync(join(place, 'index.html')))
  if (!found) throw new Error('The web app is not built (run `bun run build`).')
  return found
}

function send(res: ServerResponse, status: number, body: string | Uint8Array, type: string) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(body)
}

const json = (res: ServerResponse, status: number, value: unknown) =>
  send(res, status, JSON.stringify(value), 'application/json')

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > 1_000_000) throw new Error('request too large')
    chunks.push(chunk as Buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

export async function startWeb(options: WebServerOptions = {}): Promise<WebServer> {
  const assets = options.assets === false ? '' : (options.assets ?? findAssets())
  const token = randomBytes(24).toString('hex')
  let port = options.port ?? 0
  /** One run at a time: a check reads what a fix writes. */
  let busy = false

  /** Only the page this server served may ask: it has the token, and it came from this address. */
  const allowed = (req: IncomingMessage) => {
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`]
    const origin = req.headers.origin
    return (
      req.headers[TOKEN_HEADER] === token &&
      hosts.includes(req.headers.host ?? '') &&
      (origin === undefined ||
        hosts.some((host) => origin === `http://${host}`) ||
        (options.origins ?? []).includes(origin))
    )
  }

  /** A run answers line by line, so the page can show how far it is. */
  const stream = async (
    res: ServerResponse,
    run: (emit: (event: WebEvent) => void) => Promise<void>,
  ) => {
    if (busy) return json(res, 409, { message: 'Another check or fix is still running.' })
    busy = true
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' })
    // The page may be gone before the run ends (closed, reloaded): the run finishes all the
    // same, since a fix must not stop half-way, and its lines go nowhere.
    res.on('error', () => {})
    try {
      await run((event) => {
        if (!res.destroyed) res.write(`${JSON.stringify(event)}\n`)
      })
    } finally {
      busy = false
      if (!res.destroyed) res.end()
    }
  }

  const api = async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    if (!allowed(req)) return json(res, 403, { message: 'not allowed' })
    const route = `${req.method} ${url.pathname}`
    if (route === 'GET /api/info') return json(res, 200, await webInfo(options))
    if (route === 'GET /api/folders') {
      // A path that cannot be opened is an answer, not a failure: paths are typed by hand.
      try {
        return json(res, 200, webFolders(url.searchParams.get('path') ?? ''))
      } catch (error) {
        return json(res, 200, { problem: (error as Error).message })
      }
    }
    if (route === 'POST /api/check') {
      const request = (await body(req)) as WebRequest
      return stream(res, (emit) => webCheck(request, emit, options))
    }
    if (route === 'POST /api/fix') {
      const request = (await body(req)) as WebFixRequest
      return stream(res, (emit) => webFix(request, emit, options))
    }
    if (route === 'POST /api/undo') {
      if (busy) return json(res, 409, { message: 'Another check or fix is still running.' })
      busy = true
      try {
        const { run } = (await body(req)) as { run?: string }
        return json(res, 200, await webUndo(String(run ?? ''), options))
      } finally {
        busy = false
      }
    }
    return json(res, 404, { message: 'not found' })
  }

  const page = async (res: ServerResponse, pathname: string) => {
    if (!assets) return send(res, 404, 'not found', 'text/plain')
    const name = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1))
    const path = normalize(join(assets, name))
    if (!path.startsWith(assets + sep)) return send(res, 404, 'not found', 'text/plain')
    if (name === 'index.html') await options.beforePage?.()
    if (!existsSync(path) || !statSync(path).isFile())
      return send(res, 404, 'not found', 'text/plain')
    const type = TYPES[extname(path)] ?? 'application/octet-stream'
    if (name !== 'index.html') return send(res, 200, readFileSync(path), type)
    // The page learns from its own HTML that livesaver serves it, and with which token.
    const html = readFileSync(path, 'utf8').replace(
      `name="${TOKEN_META}" content=""`,
      `name="${TOKEN_META}" content="${token}"`,
    )
    return send(res, 200, html, type)
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const answer = url.pathname.startsWith('/api/')
      ? api(req, res, url)
      : req.method === 'GET'
        ? page(res, url.pathname)
        : Promise.resolve(send(res, 405, 'not allowed', 'text/plain'))
    answer.catch((error: unknown) => {
      const message = (error as Error).message || String(error)
      if (res.headersSent) res.end()
      else json(res, 400, { message })
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}/`,
    port,
    token,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
