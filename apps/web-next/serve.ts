/** Serve the built app as plain files, as any static host does: the app then runs on its own. */
import { join, normalize } from 'node:path'
import { DIST } from './build.js'

export function serve(port = 0): { url: string; stop: () => void } {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    async fetch(request) {
      const { pathname } = new URL(request.url)
      const name = pathname.endsWith('/') ? `${pathname}index.html` : pathname
      const path = normalize(join(DIST, decodeURIComponent(name)))
      if (!path.startsWith(`${DIST}/`)) return new Response('not found', { status: 404 })
      const file = Bun.file(path)
      if (!(await file.exists())) return new Response('not found', { status: 404 })
      return new Response(file, { headers: { 'Cache-Control': 'no-store' } })
    },
  })
  return { url: `http://127.0.0.1:${server.port}/`, stop: () => void server.stop(true) }
}
