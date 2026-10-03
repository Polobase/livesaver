/**
 * Serves the built site as GitHub Pages does: below `/livesaver/`, with the web app beside it
 * at `/livesaver/app/`, a redirect to the address with a slash for a page asked for without one,
 * and `404.html` for what is not there.
 *
 * Usage: bun serve.ts [port]   (after `bun build.ts` and a build of the app)
 */
import { existsSync, statSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { DIST as APP } from '../web/build.js'
import { BASE, OUT } from './build.js'

const isFile = (path: string) => existsSync(path) && statSync(path).isFile()
const isFolder = (path: string) => existsSync(path) && statSync(path).isDirectory()
const file = (path: string, status = 200) =>
  new Response(Bun.file(path), { status, headers: { 'Cache-Control': 'no-store' } })

export function serve(port = 0): { url: string; stop: () => void } {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    fetch(request) {
      const { pathname } = new URL(request.url)
      const missing = () => file(join(OUT, '404.html'), 404)
      if (!pathname.startsWith(BASE)) return missing()
      const rest = decodeURIComponent(pathname.slice(BASE.length))
      const inApp = rest === 'app' || rest.startsWith('app/')
      const root = inApp ? APP : OUT
      const path = normalize(join(root, inApp ? rest.slice(3) : rest))
      if (path !== root && !path.startsWith(`${root}/`)) return missing()
      if (isFile(path)) return file(path)
      if (!isFolder(path) || !isFile(join(path, 'index.html'))) return missing()
      // A folder is a page: with a slash it is served, without one the browser is sent there.
      if (pathname.endsWith('/')) return file(join(path, 'index.html'))
      return new Response(null, { status: 301, headers: { Location: `${pathname}/` } })
    },
  })
  return {
    url: `http://127.0.0.1:${server.port}${BASE}`,
    stop: () => void server.stop(true),
  }
}

if (import.meta.main) {
  const { url } = serve(Number(process.argv[2] ?? 4173))
  console.log(`The site as GitHub Pages serves it: ${url}`)
}
