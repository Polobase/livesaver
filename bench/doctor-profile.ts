/**
 * Profile a doctor run by timing every host call (read-only).
 * Usage: bun bench/doctor-profile.ts <folder>
 */

import { resolveConfig } from '../packages/cli/src/config.js'
import type { Host } from '../packages/core/src/index.js'
import { createNodeHost } from '../packages/node/src/index.js'
import { doctor } from '../packages/ops/src/index.js'

const target = process.argv[2] as string
const config = await resolveConfig({ targets: [target] })
const base = createNodeHost()
const time: Record<string, { ms: number; n: number }> = {}
function timed<A extends unknown[], R>(
  name: string,
  fn: (...a: A) => Promise<R>,
): (...a: A) => Promise<R> {
  return async (...a: A) => {
    const s = performance.now()
    try {
      return await fn(...a)
    } finally {
      const t = time[name] ?? { ms: 0, n: 0 }
      time[name] = t
      t.ms += performance.now() - s
      t.n++
    }
  }
}
const host: Host = {
  ...base,
  fs: {
    stat: timed('fs.stat', base.fs.stat.bind(base.fs)),
    read: timed('fs.read', base.fs.read.bind(base.fs)),
    readFile: timed('fs.readFile', base.fs.readFile.bind(base.fs)),
    listDir: timed('fs.listDir', base.fs.listDir.bind(base.fs)),
  },
  codec: { gunzip: timed('gunzip', base.codec.gunzip), gzip: base.codec.gzip },
}
const run = await doctor(host, {
  targets: [target],
  searchRoots: config.searchRoots,
  env: config.env,
  packCopyLimit: config.packCopyLimit,
})
console.log(`total ${(run.ms / 1000).toFixed(2)} s for ${run.results.length} sets`)
for (const [k, v] of Object.entries(time).sort((a, b) => b[1].ms - a[1].ms)) {
  console.log(`  ${k.padEnd(12)} ${(v.ms / 1000).toFixed(2)} s  (${v.n} calls)`)
}
