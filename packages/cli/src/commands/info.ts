import { readFile } from 'node:fs/promises'
import { fileRefs, openDocument } from '@livesaver/core'
import { nodeCodec } from '@livesaver/node'
import pc from 'picocolors'
import { absolute } from '../config.js'

export interface InfoFlags {
  readonly refs?: boolean
  readonly json?: boolean
}

export async function runInfo(fileArg: string, flags: InfoFlags): Promise<number> {
  const path = absolute(fileArg)
  const started = performance.now()
  const file = new Uint8Array(await readFile(path))
  const doc = await openDocument(file, nodeCodec)
  const refs = fileRefs(doc)
  const ms = performance.now() - started
  const byType = new Map<string, number>()
  for (const r of refs) {
    const key = `${r.kind}/${r.format}/type ${r.relType}`
    byType.set(key, (byType.get(key) ?? 0) + 1)
  }
  const info = {
    path,
    creator: doc.creator,
    majorVersion: doc.majorVersion,
    minorVersion: doc.minorVersion,
    gzipped: doc.gzipped,
    bytes: { file: file.length, xml: doc.xml.length },
    elements: doc.index.count,
    references: refs.length,
    distinctReferences: new Set(refs.map((r) => r.key)).size,
    byType: Object.fromEntries([...byType.entries()].sort()),
    ms: Math.round(ms),
  }
  if (flags.json) {
    console.log(JSON.stringify(flags.refs ? { ...info, refs } : info, null, 2))
    return 0
  }
  console.log(pc.bold(path))
  console.log(
    `  ${info.creator || '(no creator)'}  ·  MinorVersion ${info.minorVersion}  ·  ${info.gzipped ? 'gzip' : 'plain XML'}`,
  )
  console.log(
    `  ${(file.length / 1e6).toFixed(1)} MB → ${(doc.xml.length / 1e6).toFixed(1)} MB XML, ${info.elements.toLocaleString()} elements, read in ${info.ms} ms`,
  )
  console.log(`  ${refs.length} sample/device references (${info.distinctReferences} distinct)`)
  for (const [k, n] of Object.entries(info.byType)) console.log(`    ${k}: ${n}`)
  if (flags.refs) {
    for (const r of refs) {
      console.log(
        `  ${pc.cyan(r.name || '(empty)')}  ${pc.dim(`${r.kind} ${r.format} type=${r.relType}`)}  ${r.relPath || r.path || r.hintPath}`,
      )
    }
  }
  return 0
}
