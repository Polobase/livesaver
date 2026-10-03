/** Serve the built app (and, for tests, extra folders) from this machine only. */
import { join, normalize } from 'node:path'
import { DIST } from './build.js'

export interface ServeOptions {
  readonly port?: number
  /** Called before a page is served, e.g. to rebuild after a change. */
  readonly beforePage?: () => Promise<void>
}

export function serve(options: ServeOptions = {}): { url: string; stop: () => void } {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: options.port ?? 0,
    async fetch(request) {
      const { pathname } = new URL(request.url)
      const name = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1))
      const path = normalize(join(DIST, name))
      if (!path.startsWith(`${DIST}/`)) return new Response('not found', { status: 404 })
      if (name === 'index.html') await options.beforePage?.()
      const file = Bun.file(path)
      if (!(await file.exists())) return new Response('not found', { status: 404 })
      return new Response(file, { headers: { 'Cache-Control': 'no-store' } })
    },
  })
  return { url: `http://127.0.0.1:${server.port}/`, stop: () => void server.stop(true) }
}
