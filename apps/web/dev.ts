/**
 * The web app on http://127.0.0.1:5173/, rebuilt whenever the page is loaded after a source
 * change (reload the page to see it).
 *
 * Usage: bun dev.ts [port]
 */
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { build } from './build.js'
import { serve } from './serve.js'

const ROOT = join(import.meta.dir, '..', '..')
const WATCHED = ['apps/web/index.html', 'apps/web/src/**/*', 'packages/*/src/**/*.ts']

function newestChange(): number {
  let newest = 0
  for (const pattern of WATCHED)
    for (const file of new Bun.Glob(pattern).scanSync({ cwd: ROOT }))
      newest = Math.max(newest, statSync(join(ROOT, file)).mtimeMs)
  return newest
}

let builtAt = 0
const { url } = serve({
  port: Number(process.argv[2] ?? 5173),
  async beforePage() {
    const changed = newestChange()
    if (changed <= builtAt) return
    const started = performance.now()
    await build({ minify: false })
    builtAt = changed
    console.log(`built in ${Math.round(performance.now() - started)} ms`)
  },
})
console.log(`livesaver web app: ${url}`)
