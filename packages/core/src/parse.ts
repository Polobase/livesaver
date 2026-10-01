/**
 * Reading a set (read → gunzip → find references) is the CPU-heavy part of a run and independent
 * per set, so it sits behind a port: hosts may run it on worker threads while decisions stay in
 * order on the main thread.
 */
import { analyzeSet, type SetInfo } from './analyze.js'
import { documentFromXml, type LiveDoc, openDocument } from './document.js'
import { type FileRef, fileRefs } from './fileref.js'
import type { Codec, FileStat, Host } from './host.js'
import type { ByteSearch } from './search.js'

export type ParsedSet =
  | {
      readonly ok: true
      readonly doc: LiveDoc
      readonly refs: readonly FileRef[]
      /** The file as it was when read; a write is refused if it changed since (stale plan). */
      readonly stat?: FileStat
    }
  | { readonly ok: false; readonly error: string }

/** A set measured for `status`: its analysis and references, without the XML. */
export type InspectedSet =
  | {
      readonly ok: true
      readonly info: SetInfo
      readonly refs: readonly FileRef[]
      readonly stat?: FileStat
    }
  | { readonly ok: false; readonly error: string; readonly stat?: FileStat }

export interface SetParser {
  parse(path: string): Promise<ParsedSet>
  /** Analyze a set (hosts with worker threads do it there); falls back to `inspectFile`. */
  inspect?(path: string): Promise<InspectedSet>
  close(): Promise<void>
}

/**
 * Analysis and references of a set file. The XML must be well-formed (it is scanned strictly), so
 * a truncated set is reported as unreadable instead of being measured in part.
 */
export async function inspectFile(
  file: Uint8Array,
  codec: Codec,
  search?: ByteSearch,
): Promise<{ info: SetInfo; refs: FileRef[] }> {
  const opened = await openDocument(file, codec, search ? { search } : {})
  const doc = documentFromXml(opened.xml, opened.gzipped, true, search)
  return { info: analyzeSet(doc), refs: fileRefs(doc) }
}

/** Parse on the calling thread (browsers, tests, `--workers 0`). */
export function inProcessParser(host: Host): SetParser {
  return {
    async parse(path) {
      try {
        const stat = await host.fs.stat(path)
        const file = await host.fs.readFile(path)
        const doc = await openDocument(file, host.codec, host.search ? { search: host.search } : {})
        return { ok: true, doc, refs: fileRefs(doc), ...(stat ? { stat } : {}) }
      } catch (error) {
        return { ok: false, error: `unreadable: ${(error as Error).message}` }
      }
    },
    async inspect(path) {
      const stat = await host.fs.stat(path)
      try {
        if (!stat) throw new Error(`No such file or directory: '${path}'`)
        const { info, refs } = await inspectFile(
          await host.fs.readFile(path),
          host.codec,
          host.search,
        )
        return { ok: true, info, refs, stat }
      } catch (error) {
        return { ok: false, error: (error as Error).message, ...(stat ? { stat } : {}) }
      }
    },
    async close() {},
  }
}
