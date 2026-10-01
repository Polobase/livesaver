/**
 * Scanner throughput on real Live files (read-only).
 * Usage: bun bench/scan.ts <file.als> [more.als …]
 */
import { readFileSync, statSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { scan } from '../packages/xml/src/index.js'

for (const path of process.argv.slice(2)) {
  const raw = readFileSync(path)
  const t0 = performance.now()
  const xml = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw
  const t1 = performance.now()
  let best = Number.POSITIVE_INFINITY
  let count = 0
  for (let run = 0; run < 5; run++) {
    const s = performance.now()
    count = scan(xml).count
    best = Math.min(best, performance.now() - s)
  }
  const mb = xml.length / 1e6
  console.log(
    `${path.split('/').at(-1)}: ${(statSync(path).size / 1e6).toFixed(1)} MB gz → ${mb.toFixed(1)} MB xml, ` +
      `${count.toLocaleString()} elements | gunzip ${(t1 - t0).toFixed(0)} ms | ` +
      `scan ${best.toFixed(0)} ms = ${(mb / (best / 1000)).toFixed(0)} MB/s`,
  )
}
