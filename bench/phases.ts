/**
 * Where does doctor's time go? Reads every set below a folder and times read / gunzip / scan /
 * fileRefs separately (read-only). Usage: bun bench/phases.ts <folder>
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { documentFromXml, fileRefs } from '../packages/core/src/index.js'
import { nodeSearch } from '../packages/node/src/index.js'

function sets(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'Backup') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) sets(p, out)
    else if (e.name.toLowerCase().endsWith('.als') && !e.name.startsWith('._')) out.push(p)
  }
  return out
}

const files = sets(process.argv[2] as string)
const bun = (globalThis as { Bun?: { gunzipSync(d: Uint8Array): Uint8Array } }).Bun
const t = { read: 0, gunzip: 0, open: 0, refs: 0 }
let gz = 0
let xmlBytes = 0
let refCount = 0
for (const f of files) {
  let s = performance.now()
  const raw = readFileSync(f)
  t.read += performance.now() - s
  gz += statSync(f).size
  s = performance.now()
  const xml = bun ? bun.gunzipSync(raw) : new Uint8Array(gunzipSync(raw))
  t.gunzip += performance.now() - s
  xmlBytes += xml.length
  s = performance.now()
  const doc = documentFromXml(xml, true, false, nodeSearch)
  t.open += performance.now() - s
  s = performance.now()
  refCount += fileRefs(doc).length
  t.refs += performance.now() - s
}
console.log(
  `${files.length} sets, ${(gz / 1e6).toFixed(0)} MB gz → ${(xmlBytes / 1e9).toFixed(2)} GB XML, ${refCount} refs`,
)
for (const [k, v] of Object.entries(t)) console.log(`  ${k.padEnd(7)} ${(v / 1000).toFixed(2)} s`)
