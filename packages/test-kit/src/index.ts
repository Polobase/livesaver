/**
 * Test helpers shared by livesaver's packages. Test-only code: it may use Node APIs.
 * The XML snippets below were taken from real sets saved by Live 9–12 (see fixtures/README.md).
 */
import { createHash } from 'node:crypto'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'
import { type Codec, type LiveDoc, openDocument } from '@livesaver/core'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

export const WINDOWS_PATH = 'E:\\Samples\\Lib1\\Kick\\1.wav'

function utf16leHexUpper(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    out += (c & 0xff).toString(16).padStart(2, '0') + (c >> 8).toString(16).padStart(2, '0')
  }
  return out.toUpperCase()
}

/** Live 10 set with one old-format sample reference (structure copied from a real set). */
export const OLD_SET = `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="10.0_377" SchemaChangeCount="3" Creator="Ableton Live 10.1.14" Revision="b749619222aa22166bd6c60edaae294eacb3413a">
\t<LiveSet>
\t\t<SampleRef>
\t\t\t<FileRef>
\t\t\t\t<HasRelativePath Value="true" />
\t\t\t\t<RelativePathType Value="1" />
\t\t\t\t<RelativePath>
\t\t\t\t\t<RelativePathElement Id="239" Dir="" />
\t\t\t\t\t<RelativePathElement Id="240" Dir="Other Project" />
\t\t\t\t\t<RelativePathElement Id="241" Dir="Samples" />
\t\t\t\t\t<RelativePathElement Id="242" Dir="Imported" />
\t\t\t\t</RelativePath>
\t\t\t\t<Name Value="1.wav" />
\t\t\t\t<Type Value="1" />
\t\t\t\t<Data>
\t\t\t\t\t{data}
\t\t\t\t</Data>
\t\t\t\t<RefersToFolder Value="false" />
\t\t\t\t<SearchHint>
\t\t\t\t\t<PathHint>
\t\t\t\t\t\t<RelativePathElement Id="25" Dir="Samples" />
\t\t\t\t\t\t<RelativePathElement Id="26" Dir="Lib1" />
\t\t\t\t\t\t<RelativePathElement Id="27" Dir="Kick" />
\t\t\t\t\t</PathHint>
\t\t\t\t\t<FileSize Value="2000324" />
\t\t\t\t\t<Crc Value="17226" />
\t\t\t\t\t<MaxCrcSize Value="16384" />
\t\t\t\t\t<HasExtendedInfo Value="true" />
\t\t\t\t</SearchHint>
\t\t\t\t<LivePackName Value="" />
\t\t\t\t<LivePackId Value="" />
\t\t\t</FileRef>
\t\t\t<LastModDate Value="1567153312" />
\t\t</SampleRef>
\t</LiveSet>
</Ableton>
`.replace('{data}', `${utf16leHexUpper(WINDOWS_PATH)}0000`)

/** Live 9 reference without relative path (HasRelativePath false, empty list, no Ids). */
export const LIVE9_SET = `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="4" MinorVersion="9.0_305" SchemaChangeCount="10" Creator="Ableton Live 9.1.1" Revision="6911b41930178a1030c392279609f502cbe37473">
\t<LiveSet>
\t\t<SampleRef>
\t\t\t<FileRef>
\t\t\t\t<HasRelativePath Value="false" />
\t\t\t\t<RelativePathType Value="0" />
\t\t\t\t<RelativePath />
\t\t\t\t<Name Value="Rock &amp; Roll.wav" />
\t\t\t\t<Type Value="2" />
\t\t\t\t<Data />
\t\t\t\t<RefersToFolder Value="false" />
\t\t\t\t<SearchHint>
\t\t\t\t\t<PathHint>
\t\t\t\t\t\t<RelativePathElement Dir="Users" />
\t\t\t\t\t\t<RelativePathElement Dir="someone" />
\t\t\t\t\t</PathHint>
\t\t\t\t\t<FileSize Value="0" />
\t\t\t\t\t<Crc Value="0" />
\t\t\t\t\t<MaxCrcSize Value="16384" />
\t\t\t\t\t<HasExtendedInfo Value="true" />
\t\t\t\t</SearchHint>
\t\t\t\t<LivePackName Value="" />
\t\t\t\t<LivePackId Value="" />
\t\t\t</FileRef>
\t\t\t<LastModDate Value="1392748674" />
\t\t</SampleRef>
\t</LiveSet>
</Ableton>
`

const DEVICE_SET = `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="12.0_12300" SchemaChangeCount="1" Creator="Ableton Live 12.3.2" Revision="bba1e05a8769233839bfbad067d72440d966db31">
\t<LiveSet>
\t\t<MxDeviceAudioEffect Id="0">
\t\t\t<PatchSlot>
\t\t\t\t<Value>
\t\t\t\t\t<MxPatchRef Id="1">
\t\t\t\t\t\t<FileRef>
\t\t\t\t\t\t\t<RelativePathType Value="{rel_type}" />
\t\t\t\t\t\t\t<RelativePath Value="{rel_path}" />
\t\t\t\t\t\t\t<Path Value="{path}" />
\t\t\t\t\t\t\t<Type Value="2" />
\t\t\t\t\t\t\t<LivePackName Value="{pack_name}" />
\t\t\t\t\t\t\t<LivePackId Value="{pack_id}" />
\t\t\t\t\t\t\t<OriginalFileSize Value="{size}" />
\t\t\t\t\t\t\t<OriginalCrc Value="{crc}" />
\t\t\t\t\t\t\t<SourceHint Value="" />
\t\t\t\t\t\t</FileRef>
\t\t\t\t\t\t<LastModDate Value="1588076908" />
\t\t\t\t\t\t<SourceContext />
\t\t\t\t\t\t<SampleUsageHint Value="0" />
\t\t\t\t\t</MxPatchRef>
\t\t\t\t</Value>
\t\t\t</PatchSlot>
\t\t</MxDeviceAudioEffect>
\t</LiveSet>
</Ableton>
`

/** Live 10 set with one Max device in another project (template: fill {size} and {crc}). */
export const OLD_DEVICE_SET = `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="10.0_377" SchemaChangeCount="2" Creator="Ableton Live 10.1" Revision="820f098a4a1eff42a9be3d90e07536cb8104c459">
\t<LiveSet>
\t\t<MxDeviceAudioEffect Id="0">
\t\t\t<PatchSlot>
\t\t\t\t<Value>
\t\t\t\t\t<MxDPatchRef Id="1">
\t\t\t\t\t\t<FileRef>
\t\t\t\t\t\t\t<HasRelativePath Value="true" />
\t\t\t\t\t\t\t<RelativePathType Value="1" />
\t\t\t\t\t\t\t<RelativePath>
\t\t\t\t\t\t\t\t<RelativePathElement Id="44" Dir="" />
\t\t\t\t\t\t\t\t<RelativePathElement Id="45" Dir="Other Project" />
\t\t\t\t\t\t\t\t<RelativePathElement Id="46" Dir="Presets" />
\t\t\t\t\t\t\t\t<RelativePathElement Id="47" Dir="Audio Effects" />
\t\t\t\t\t\t\t\t<RelativePathElement Id="48" Dir="Max Audio Effect" />
\t\t\t\t\t\t\t\t<RelativePathElement Id="49" Dir="Imported" />
\t\t\t\t\t\t\t</RelativePath>
\t\t\t\t\t\t\t<Name Value="LFO.amxd" />
\t\t\t\t\t\t\t<Type Value="2" />
\t\t\t\t\t\t\t<Data />
\t\t\t\t\t\t\t<RefersToFolder Value="false" />
\t\t\t\t\t\t\t<SearchHint>
\t\t\t\t\t\t\t\t<PathHint>
\t\t\t\t\t\t\t\t\t<RelativePathElement Id="10" Dir="Users" />
\t\t\t\t\t\t\t\t\t<RelativePathElement Id="11" Dir="someone" />
\t\t\t\t\t\t\t\t\t<RelativePathElement Id="12" Dir="Other Project" />
\t\t\t\t\t\t\t\t\t<RelativePathElement Id="13" Dir="Presets" />
\t\t\t\t\t\t\t\t\t<RelativePathElement Id="14" Dir="Audio Effects" />
\t\t\t\t\t\t\t\t\t<RelativePathElement Id="15" Dir="Max Audio Effect" />
\t\t\t\t\t\t\t\t\t<RelativePathElement Id="16" Dir="Imported" />
\t\t\t\t\t\t\t\t</PathHint>
\t\t\t\t\t\t\t\t<FileSize Value="{size}" />
\t\t\t\t\t\t\t\t<Crc Value="{crc}" />
\t\t\t\t\t\t\t\t<MaxCrcSize Value="16384" />
\t\t\t\t\t\t\t\t<HasExtendedInfo Value="true" />
\t\t\t\t\t\t\t</SearchHint>
\t\t\t\t\t\t\t<LivePackName Value="" />
\t\t\t\t\t\t\t<LivePackId Value="" />
\t\t\t\t\t\t</FileRef>
\t\t\t\t\t\t<LastModDate Value="1566943162" />
\t\t\t\t\t\t<SourceContext />
\t\t\t\t\t\t<SampleUsageHint Value="0" />
\t\t\t\t\t</MxDPatchRef>
\t\t\t\t</Value>
\t\t\t</PatchSlot>
\t\t</MxDeviceAudioEffect>
\t</LiveSet>
</Ableton>
`

function xmlAttr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function oldDeviceSet(size: number, crc: number): string {
  return OLD_DEVICE_SET.replace('{size}', String(size)).replace('{crc}', String(crc))
}

/** A Live 12 set with one Max device reference. */
export function deviceSet(
  path: string,
  size: number,
  crc: number,
  options: { relType?: number; relPath?: string; packName?: string; packId?: string } = {},
): string {
  return DEVICE_SET.replace('{rel_type}', String(options.relType ?? 1))
    .replace('{rel_path}', xmlAttr(options.relPath ?? ''))
    .replace('{path}', xmlAttr(path))
    .replace('{pack_name}', xmlAttr(options.packName ?? ''))
    .replace('{pack_id}', xmlAttr(options.packId ?? ''))
    .replace('{size}', String(size))
    .replace('{crc}', String(crc))
}

/** Stand-in for a Max device: Live's .amxd header with the device type code, then filler. */
export function amxd(code = 'aaaa', filler = 'x', size = 20000): Uint8Array {
  const head = `ampf\x04\x00\x00\x00${code}meta`
  const text = (head + filler.repeat(size)).slice(0, size)
  return Uint8Array.from(text, (c) => c.charCodeAt(0))
}

/** gzip via Node's zlib, for tests. */
export const testCodec: Codec = {
  gunzip: async (data) => new Uint8Array(gunzipSync(data)),
  gzip: async (data, level) => new Uint8Array(gzipSync(data, { level })),
}

export async function docFromText(text: string, gzip = false): Promise<LiveDoc> {
  const bytes = new TextEncoder().encode(text)
  return openDocument(gzip ? new Uint8Array(gzipSync(bytes)) : bytes, testCodec)
}

/** The repository's `fixtures/` folder: projects and samples saved by Live (fixtures/README.md). */
export function fixturesDir(): string {
  return join(REPO, 'fixtures')
}

/** A fresh temp directory (real path, so macOS /var → /private/var doesn't confuse comparisons). */
export function tempDir(prefix = 'livesaver-'): { path: string; cleanup: () => void } {
  const path = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) }
}

export function writeFile(path: string, data: Uint8Array | string): string {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, data)
  return path
}

/** Write a gzipped set like Live does. */
export function writeSet(path: string, text: string): string {
  return writeFile(path, new Uint8Array(gzipSync(new TextEncoder().encode(text))))
}

export function makeProject(parent: string, name: string): string {
  const root = join(parent, `${name} Project`)
  mkdirSync(join(root, 'Ableton Project Info'), { recursive: true })
  return root
}

/** Copy the fixture projects and samples into `dir` (times preserved); returns their paths. */
export function copyFixtures(dir: string): { projects: string; samples: string } {
  const projects = join(dir, 'projects')
  const samples = join(dir, 'samples')
  cpSync(join(fixturesDir(), 'projects'), projects, { recursive: true, preserveTimestamps: true })
  cpSync(join(fixturesDir(), 'samples'), samples, { recursive: true, preserveTimestamps: true })
  return { projects, samples }
}

/** A set's XML text (gunzipped). */
export function readSet(path: string): string {
  const raw = readFileSync(path)
  const xml = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw
  return new TextDecoder().decode(xml)
}

const SAMPLE_REF_RE =
  /<(SampleRef|MxPatchRef|MxDPatchRef)(?: Id="\d+")?>\s*<FileRef>([\s\S]*?)<\/FileRef>(?:\s*<LastModDate Value="([^"]*)" \/>)?/g

/** The document with all FileRef bodies and LastModDate values blanked out. */
export function stripSampleRefs(text: string): string {
  return text.replace(
    SAMPLE_REF_RE,
    (whole, _tag: string, body: string, lmd: string | undefined) => {
      let out = whole.replace(`<FileRef>${body}</FileRef>`, '<FileRef>#</FileRef>')
      if (lmd !== undefined)
        out = out.replace(`<LastModDate Value="${lmd}" />`, '<LastModDate Value="#" />')
      return out
    },
  )
}

/** FileRef bodies of a set, in document order. */
export function fileRefBodies(text: string): string[] {
  return [...text.matchAll(SAMPLE_REF_RE)].map((m) => m[2] as string)
}

/** path → [mtime (µs), sha1] of every file below `dir`. */
export function snapshot(dir: string): Record<string, [number, string]> {
  const out: Record<string, [number, string]> = {}
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile()) {
        const us = Math.round(Number(statSync(p, { bigint: true }).mtimeNs) / 1000)
        out[p] = [us, createHash('sha1').update(readFileSync(p)).digest('hex')]
      }
    }
  }
  walk(dir)
  return out
}
export * from './browser.js'
export * from './builders.js'
export * from './demo.js'
