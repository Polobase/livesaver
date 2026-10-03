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
  // A test runner sets NODE_ENV to "test", and Vite would then build Vue's development version.
  // What the tests load must be what ships.
  const before = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    await viteBuild({ root: HERE, logLevel: 'warn' })
  } finally {
    if (before === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = before
  }
}

if (import.meta.main) {
  await build()
  console.log(`built ${DIST}`)
}
