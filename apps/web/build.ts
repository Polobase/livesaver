/**
 * Bundle the web app into `dist/`. The page and its two workers are separate entry points, each
 * with a fixed name, because the page starts the workers by URL (`./engine.worker.js`).
 *
 * Usage: bun build.ts
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const HERE = import.meta.dir
export const DIST = join(HERE, 'dist')
/** The stylesheets, joined in this order into one `styles.css`. */
const STYLES = ['styles.css', 'results.css', 'fix.css']

export async function build(options: { minify?: boolean } = {}): Promise<void> {
  mkdirSync(DIST, { recursive: true })
  const result = await Bun.build({
    entrypoints: ['main.tsx', 'engine.worker.ts', 'parse.worker.ts'].map((f) =>
      join(HERE, 'src', f),
    ),
    outdir: DIST,
    target: 'browser',
    format: 'esm',
    naming: '[name].js',
    minify: options.minify ?? true,
    sourcemap: 'linked',
  })
  if (!result.success) throw new AggregateError(result.logs, 'the web app did not build')
  copyFileSync(join(HERE, 'index.html'), join(DIST, 'index.html'))
  const styles = STYLES.map((name) => readFileSync(join(HERE, 'src', name), 'utf8'))
  writeFileSync(join(DIST, 'styles.css'), styles.join('\n'))
}

if (import.meta.main) {
  await build()
  console.log(`built ${DIST}`)
}
