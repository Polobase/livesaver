/**
 * The app while it is being worked on: Vite's development server (changes show at once), with
 * livesaver's API behind it, so the page runs as `livesaver web` serves it and can also fix.
 * It uses the real settings: Fix and Undo here write for real.
 *
 * Usage: bun dev.ts [port]
 */
import { startWeb } from 'livesaver'
import { createServer } from 'vite'

const port = Number(process.argv[2] ?? 5173)
const origins = [`http://localhost:${port}`, `http://127.0.0.1:${port}`]
const api = await startWeb({ port: 0, assets: false, origins })

const server = await createServer({
  root: import.meta.dir,
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
    proxy: { '/api': { target: api.url, changeOrigin: true } },
  },
  plugins: [
    {
      // What `livesaver web` does when it serves the page: the token tells the page that
      // livesaver is behind it.
      name: 'livesaver-token',
      transformIndexHtml: (html) =>
        html.replace(
          'name="livesaver-local" content=""',
          `name="livesaver-local" content="${api.token}"`,
        ),
    },
  ],
})
await server.listen()
console.log(`livesaver web app (development): http://localhost:${port}/`)
