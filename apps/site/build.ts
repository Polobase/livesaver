/**
 * Builds the site into `.output/public`: static files for the path it is served at
 * (`/livesaver/` on GitHub Pages). The web app is not part of it: `serve.ts`, and the workflow
 * that deploys, put the app's files beside it at `app/`.
 *
 * Usage: bun build.ts [base]
 */
import { join } from 'node:path'

const HERE = import.meta.dir
export const OUT = join(HERE, '.output', 'public')
/** Where GitHub Pages serves the site of the repository `livesaver`. */
export const BASE = '/livesaver/'

export async function build(base = BASE): Promise<void> {
  const run = Bun.spawn(['bunx', '--bun', 'nuxi', 'generate'], {
    cwd: HERE,
    // A test runner sets NODE_ENV to "test"; what is tested must be what is deployed.
    env: { ...process.env, NUXT_APP_BASE_URL: base, NODE_ENV: 'production' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [out, err, code] = await Promise.all([
    new Response(run.stdout).text(),
    new Response(run.stderr).text(),
    run.exited,
  ])
  if (code !== 0) throw new Error(`The site did not build:\n${out}\n${err}`)
}

if (import.meta.main) {
  await build(process.argv[2] ?? BASE)
  console.log(`built ${OUT}`)
}
