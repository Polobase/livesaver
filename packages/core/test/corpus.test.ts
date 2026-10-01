/**
 * Real-library corpus test, READ-ONLY. Skipped unless LIVESAVER_CORPUS points at a folder:
 *
 *   LIVESAVER_CORPUS=<folder> bun test corpus
 *   LIVESAVER_CORPUS=~/Music/Ableton LIVESAVER_CORPUS_EXT=.adg,.adv,.alc bun test corpus
 *
 * Every Live document below the folder (Backup folders included) must decode, scan, and round-trip
 * byte-identically through an empty patch. On every 7th file, the byte-search reference finder is
 * cross-checked against an independent regular expression for the same references.
 */
import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { nodeCodec, nodeSearch } from '@livesaver/node'
import { patch, scan } from '@livesaver/xml'
import { fileRefs, LiveFormatError, openDocument } from '../src/index.js'

const root = process.env.LIVESAVER_CORPUS?.replace(/^~(?=$|\/)/, homedir())
const extensions = (process.env.LIVESAVER_CORPUS_EXT ?? '.als')
  .split(',')
  .map((e) => e.trim().toLowerCase())

const SAMPLE_REF_RE =
  /<(SampleRef|MxPatchRef|MxDPatchRef)(?: Id="\d+")?>\s*<FileRef>([\s\S]*?)<\/FileRef>(?:\s*<LastModDate Value="([^"]*)" \/>)?/g

function files(dir: string, out: string[] = []): string[] {
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) files(p, out)
    else if (extensions.some((x) => e.name.toLowerCase().endsWith(x))) out.push(p)
  }
  return out
}

;(root ? test : test.skip)(
  'every Live document decodes, scans and round-trips byte-identically',
  async () => {
    const all = files(root as string)
    const stats = { files: all.length, xml: 0, bytes: 0, refs: 0, unsupported: 0, crossChecked: 0 }
    const failures: string[] = []
    for (const [i, path] of all.entries()) {
      let doc: Awaited<ReturnType<typeof openDocument>>
      try {
        doc = await openDocument(new Uint8Array(readFileSync(path)), nodeCodec, {
          search: nodeSearch,
        })
      } catch (error) {
        if (error instanceof LiveFormatError && /binary|not an Ableton XML/.test(error.message)) {
          stats.unsupported++
          continue
        }
        failures.push(`${path}: ${(error as Error).message}`)
        continue
      }
      stats.xml++
      stats.bytes += doc.xml.length
      try {
        const index = scan(doc.xml, { strict: false })
        const same = patch(index).apply()
        if (same.length !== doc.xml.length || !same.every((b, k) => b === doc.xml[k]))
          failures.push(`${path}: round trip differs`)
      } catch (error) {
        failures.push(`${path}: scan: ${(error as Error).message}`)
      }
      const refs = fileRefs(doc)
      stats.refs += refs.length
      if (i % 7 === 0) {
        stats.crossChecked++
        const text = new TextDecoder().decode(doc.xml)
        const expected = [...text.matchAll(SAMPLE_REF_RE)].length
        if (expected !== refs.length)
          failures.push(`${path}: ${refs.length} refs, the regular expression finds ${expected}`)
      }
    }
    console.log(
      `corpus ${root}: ${stats.files} files, ${stats.xml} XML (${(stats.bytes / 1e9).toFixed(2)} GB), ` +
        `${stats.unsupported} binary/legacy, ${stats.refs} references, ${stats.crossChecked} cross-checked`,
    )
    for (const f of failures.slice(0, 20)) console.log(`  FAIL ${f}`)
    expect(failures).toEqual([])
  },
  { timeout: 1_800_000 },
)
