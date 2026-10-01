/**
 * Sync the workspace "version" fields recorded in bun.lock with each workspace
 * package.json. Bun 1.3.1 does not refresh them on `bun install`, and
 * `bun pm pack` / `bun publish` resolve `workspace:*` from bun.lock, so run this
 * right after `changeset version` (see docs/releasing.md).
 *
 * Usage: bun scripts/sync-lock-versions.ts [repo root]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2] ?? '.'
const lockPath = join(root, 'bun.lock')
const lines = readFileSync(lockPath, 'utf8').split('\n')

const WORKSPACE = /^ {4}"(packages[^"]*)": \{$/
const BLOCK_END = /^ {2}\},?$/
const VERSION = /^( {6}"version": ")([^"]+)(",)$/

let current: string | null = null
let changed = 0
const out = lines.map((line) => {
  const ws = WORKSPACE.exec(line)
  if (ws?.[1] !== undefined) {
    current = ws[1]
    return line
  }
  if (BLOCK_END.test(line)) current = null
  const v = VERSION.exec(line)
  if (current === null || v === null) return line
  const [, prefix = '', recorded = '', suffix = ''] = v
  const pkg = JSON.parse(readFileSync(join(root, current, 'package.json'), 'utf8')) as {
    version?: unknown
  }
  if (typeof pkg.version !== 'string' || pkg.version === recorded) return line
  console.log(`${current}: ${recorded} -> ${pkg.version}`)
  changed++
  return `${prefix}${pkg.version}${suffix}`
})

if (changed > 0) writeFileSync(lockPath, out.join('\n'))
console.log(`bun.lock workspace versions updated: ${changed}`)
