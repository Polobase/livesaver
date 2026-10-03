/**
 * The web app on http://127.0.0.1:5173/ as `livesaver web` serves it (so it can also fix),
 * rebuilt whenever the page is loaded after a source change (reload the page to see it).
 *
 * Usage: bun dev.ts [port]
 */
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { startWeb } from 'livesaver'
import { build, DIST } from './build.js'

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
const rebuild = async () => {
  const changed = newestChange()
  if (changed <= builtAt) return
  const started = performance.now()
  await build({ minify: false })
  builtAt = changed
  console.log(`built in ${Math.round(performance.now() - started)} ms`)
}
await rebuild()
const { url } = await startWeb({
  port: Number(process.argv[2] ?? 5173),
  assets: DIST,
  beforePage: rebuild,
})
console.log(`livesaver web app: ${url}`)
