/**
 * Build the app into `dist/` (Vite). The files use relative URLs, so the same folder is what
 * GitHub Pages serves and what `livesaver web` ships.
 *
 * Usage: bun build.ts
 */
import { join } from 'node:path'
import { build as viteBuild } from 'vite'

const HERE = import.meta.dir
export const DIST = join(HERE, 'dist')

export async function build(): Promise<void> {
  await viteBuild({ root: HERE, logLevel: 'warn' })
}

if (import.meta.main) {
  await build()
  console.log(`built ${DIST}`)
}
