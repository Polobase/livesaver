/**
 * Make a file saved by Live publishable as a fixture. Live stores the absolute path of every file
 * a set uses, which shows the folder (and user name) it was saved in. This replaces that folder in
 * the document's text with a neutral one and changes nothing else.
 *
 * Only paths in plain text are rewritten. Paths inside binary data (the `Data` hex of Live 9/10
 * FileRefs, plug-in states) would need that data re-encoded; if the folder still occurs in any
 * form afterwards (text, hex, UTF-16), the file is left unchanged and the script fails.
 *
 * Usage: bun scripts/anonymize-fixture.ts [--from <folder>] [--to <folder>] <file.als|.adg|…>…
 *   --from  the folder to hide (default: your home folder)
 *   --to    what to show instead (default: /Users/someone)
 */
import { readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { gunzipSync, gzipSync } from 'node:zlib'

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Every form in which a folder name could hide in a Live document. */
function forms(text: string): Buffer[] {
  const hex = Buffer.from(text).toString('hex')
  return [
    Buffer.from(text),
    Buffer.from(escapeXml(text)),
    Buffer.from(hex),
    Buffer.from(hex.toUpperCase()),
    Buffer.from(text, 'utf16le'),
    Buffer.from(Buffer.from(text, 'utf16le').swap16()),
  ]
}

function anonymize(file: string, from: string, to: string): number {
  const raw = readFileSync(file)
  const gzipped = raw[0] === 0x1f && raw[1] === 0x8b
  const xml = gzipped ? gunzipSync(raw) : raw
  const text = xml.toString('utf8')
  if (Buffer.compare(Buffer.from(text, 'utf8'), xml) !== 0) throw new Error('not UTF-8 text')
  const [oldText, newText] = [escapeXml(from), escapeXml(to)]
  if (text.includes(newText)) throw new Error(`already contains ${to}`)
  // Only whole folder names: "/Users/me" must not match inside "/Users/merle".
  const pattern = new RegExp(`${escapeRegExp(oldText)}(?=[/"'<]|&quot;|&apos;)`, 'g')
  let count = 0
  const result = text.replace(pattern, () => {
    count++
    return newText
  })
  // Nothing else changed: putting the folder back gives the original text.
  if (result.replaceAll(newText, oldText) !== text) throw new Error('not reversible')
  const out = Buffer.from(result, 'utf8')
  // The home folder may also hide in paths outside `from`, e.g. in a plug-in's state.
  const home = homedir()
  for (const hidden of from.startsWith(`${home}/`) ? [from, home] : [from])
    for (const form of forms(hidden))
      if (out.includes(form)) throw new Error(`${hidden} is still in the file (binary data?)`)
  if (count === 0) return 0
  const { atime, mtime } = statSync(file)
  writeFileSync(file, gzipped ? gzipSync(out) : out)
  utimesSync(file, atime, mtime)
  return count
}

const args = process.argv.slice(2)
let from = homedir()
let to = '/Users/someone'
const files: string[] = []
for (let i = 0; i < args.length; i++) {
  const arg = args[i] as string
  if (arg === '--from') from = (args[++i] ?? '').replace(/\/+$/, '')
  else if (arg === '--to') to = (args[++i] ?? '').replace(/\/+$/, '')
  else files.push(arg)
}
if (!files.length || !from || !to) {
  console.error('usage: bun scripts/anonymize-fixture.ts [--from <folder>] [--to <folder>] <file>…')
  process.exit(2)
}
let failed = false
for (const file of files) {
  try {
    console.log(`${file}: ${anonymize(file, from, to)} paths`)
  } catch (error) {
    console.error(`${file}: ${(error as Error).message}`)
    failed = true
  }
}
process.exit(failed ? 1 : 0)
