/**
 * Applying a plan: every change goes through the host's write ports and is recorded in the run's
 * journal before and after it happens (write-ahead), so a crash leaves a record and `undo` knows
 * exactly what to reverse. Originals are kept in the run folder: Live keeps only its newest ten
 * backups, so a Backup/ copy cannot be relied on for undo.
 */
import {
  COMMENT_ATTR,
  encodeTags,
  type FsWrite,
  type Host,
  posix,
  TAGS_ATTR,
  type Tag,
} from '@livesaver/core'
import type { Writer } from './collect.js'
import type { Probe } from './probe.js'

export interface RunContext {
  /** e.g. "2026-09-30_214501_collect_apply". */
  readonly id: string
  readonly dir: string
}

/** Hex of raw bytes (attribute values in the journal); null = absent. */
type Hex = string | null

export type JournalEntry =
  | {
      readonly t: 'begin'
      readonly id: number
      readonly op: 'copy'
      readonly source: string
      readonly destination: string
    }
  | {
      readonly t: 'end'
      readonly id: number
      readonly op: 'copy'
      readonly asd: boolean
      readonly sha1: string
    }
  | {
      readonly t: 'begin'
      readonly id: number
      readonly op: 'write-set'
      readonly set: string
      readonly backup: string
      readonly original: string
      readonly sha1: string
    }
  | { readonly t: 'end'; readonly id: number; readonly op: 'write-set' }
  | {
      readonly t: 'begin'
      readonly id: number
      readonly op: 'tags'
      readonly path: string
      readonly before: Hex
      readonly after: Hex
    }
  | { readonly t: 'end'; readonly id: number; readonly op: 'tags' }
  | {
      readonly t: 'begin'
      readonly id: number
      readonly op: 'comments'
      readonly items: readonly {
        readonly path: string
        readonly before: string
        readonly after: string
      }[]
    }
  | { readonly t: 'end'; readonly id: number; readonly op: 'comments' }
  | {
      readonly t: 'begin'
      readonly id: number
      readonly op: 'replace-file'
      readonly path: string
      /** Copy of the previous content in the run folder (null: the file did not exist). */
      readonly original: string | null
      readonly sha1: string
    }
  | { readonly t: 'end'; readonly id: number; readonly op: 'replace-file' }
  | {
      readonly t: 'begin'
      readonly id: number
      readonly op: 'rename'
      readonly from: string
      readonly to: string
    }
  | { readonly t: 'end'; readonly id: number; readonly op: 'rename' }
  | { readonly t: 'undo'; readonly id: number; readonly result: string }

export type BeginEntry = Extract<JournalEntry, { t: 'begin' }>
type BeginFields = BeginEntry extends infer E
  ? E extends BeginEntry
    ? Omit<E, 't' | 'id'>
    : never
  : never
type EndFields =
  Extract<JournalEntry, { t: 'end' }> extends infer E
    ? E extends Extract<JournalEntry, { t: 'end' }>
      ? Omit<E, 't' | 'id'>
      : never
    : never

/** Keep this much space free on the target volume (Live, the OS and backups need room too). */
export const FREE_SPACE_MARGIN = 512 * 1024 * 1024

export function journalPath(run: RunContext): string {
  return posix.join(run.dir, 'journal.jsonl')
}

/** The write-ahead journal of one run. */
export class Journal {
  readonly run: RunContext
  private readonly fsw: FsWrite
  private seq = 0

  constructor(host: Host, run: RunContext) {
    const fsw = host.write
    if (!fsw) throw new Error('this host cannot write files')
    this.fsw = fsw
    this.run = run
  }

  private write(entry: JournalEntry): Promise<void> {
    return this.fsw.appendDurable(
      journalPath(this.run),
      JSON.stringify({ ...entry, at: new Date().toISOString() }),
    )
  }

  /** Log an intent; `fields` may depend on the entry's id (e.g. where the original is kept). */
  async begin(fields: BeginFields | ((id: number) => BeginFields)): Promise<number> {
    const id = ++this.seq
    const f = typeof fields === 'function' ? fields(id) : fields
    await this.write({ t: 'begin', id, ...f } as JournalEntry)
    return id
  }

  async end(id: number, fields: EndFields): Promise<void> {
    await this.write({ t: 'end', id, ...fields } as JournalEntry)
  }

  /** Mark an entry as reversed already (e.g. a rename taken back right away). */
  async undone(id: number, result: string): Promise<void> {
    await this.write({ t: 'undo', id, result })
  }

  /** A file in the run folder (originals kept for undo). */
  keep(id: number, name: string): string {
    return posix.join(this.run.dir, 'originals', `${id}-${name}`)
  }
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

/** Live's backup time stamp, local time: "2026-09-30 214501". */
export function backupStamp(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/** `<root>/Backup/<stem> [YYYY-MM-DD HHMMSS].als` like Live's own backups, then `… 2.als`, `… 3.als`. */
export async function nextBackupPath(
  setPath: string,
  root: string,
  probe: Probe,
  now = new Date(),
): Promise<string> {
  const stem = posix.splitext(posix.basename(setPath))[0]
  const folder = posix.join(root, 'Backup')
  const stamp = backupStamp(now)
  let candidate = posix.join(folder, `${stem} [${stamp}].als`)
  for (let n = 2; await probe.exists(candidate); n++) {
    probe.forget(candidate)
    candidate = posix.join(folder, `${stem} [${stamp}] ${n}.als`)
  }
  probe.forget(candidate)
  return candidate
}

function sha1(host: Host, data: Uint8Array | string): string {
  const h = host.hash.sha1()
  h.update(typeof data === 'string' ? new TextEncoder().encode(data) : data)
  return h.hex()
}

const toHex = (data: Uint8Array | undefined): Hex =>
  data ? Array.from(data, (b) => b.toString(16).padStart(2, '0')).join('') : null

export function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function writePort(host: Host): FsWrite {
  if (!host.write) throw new Error('this host cannot write files')
  return host.write
}

/** Copy a file (and its `.asd` analysis file) to a new place, journaled; refuses without room. */
export async function copyWithJournal(
  host: Host,
  journal: Journal | undefined,
  probe: Probe,
  source: string,
  destination: string,
): Promise<void> {
  const fsw = writePort(host)
  const size = await probe.size(source)
  const free = await fsw.freeBytes(posix.dirname(destination))
  if (free !== undefined && free < size + FREE_SPACE_MARGIN)
    throw new Error(`not enough free space for ${posix.basename(destination)} (${free} bytes free)`)
  const id = await journal?.begin({ op: 'copy', source, destination })
  await fsw.copyFile(source, destination)
  probe.forget(destination)
  const asd = `${source}.asd`
  let copiedAsd = false
  if ((await probe.isFile(asd)) && !(await probe.exists(`${destination}.asd`))) {
    await fsw.copyFile(asd, `${destination}.asd`)
    probe.forget(`${destination}.asd`)
    copiedAsd = true
  }
  if (journal && id !== undefined)
    await journal.end(id, {
      op: 'copy',
      asd: copiedAsd,
      sha1: await probe.contentHash(destination),
    })
}

/** A writer that performs and journals every change of a collect plan. */
export function applyWriter(
  host: Host,
  run: RunContext,
  probe: Probe,
  journal = new Journal(host, run),
): Writer {
  const fsw = writePort(host)
  return {
    apply: true,
    copy: (source, destination) => copyWithJournal(host, journal, probe, source, destination),
    async writeSet(setPath, root, data) {
      const backup = await nextBackupPath(setPath, root, probe)
      let original = ''
      const id = await journal.begin((n) => {
        original = journal.keep(n, posix.basename(setPath))
        return { op: 'write-set', set: setPath, backup, original, sha1: sha1(host, data) }
      })
      await fsw.copyFile(setPath, backup)
      // Backups stay untagged (as Live's own): Finder searches by tag find the set, not its backups.
      await host.xattr?.remove(backup, TAGS_ATTR).catch(() => {})
      await host.xattr?.remove(backup, COMMENT_ATTR).catch(() => {})
      await fsw.copyFile(setPath, original)
      await fsw.replaceFile(setPath, data)
      probe.forget(setPath)
      probe.forget(backup)
      await journal.end(id, { op: 'write-set' })
      return backup
    },
  }
}

/** Set a path's Finder tags (none: the attribute is removed), journaled with the old value. */
export async function setTags(
  host: Host,
  journal: Journal | undefined,
  path: string,
  tags: readonly Tag[],
): Promise<void> {
  const xattr = host.xattr
  if (!xattr) throw new Error('this host cannot set Finder tags')
  const after = tags.length ? encodeTags(tags) : undefined
  const id = journal
    ? await journal.begin({
        op: 'tags',
        path,
        before: toHex(await xattr.get(path, TAGS_ATTR)),
        after: toHex(after),
      })
    : undefined
  if (after) await xattr.set(path, TAGS_ATTR, after)
  else await xattr.remove(path, TAGS_ATTR)
  if (journal && id !== undefined) await journal.end(id, { op: 'tags' })
}

/** Set Finder comments, journaled with the old ones. */
export async function setComments(
  host: Host,
  journal: Journal | undefined,
  changes: ReadonlyMap<string, { readonly before: string; readonly after: string }>,
): Promise<void> {
  const finder = host.finder
  if (!finder) throw new Error('this host cannot set Finder comments')
  const items = [...changes].map(([path, { before, after }]) => ({ path, before, after }))
  const id = await journal?.begin({ op: 'comments', items })
  await finder.write(new Map(items.map((i) => [i.path, i.after])))
  if (journal && id !== undefined) await journal.end(id, { op: 'comments' })
}

/** Create or replace a file livesaver maintains (rating sheet, snapshot), keeping the old one for undo. */
export async function writeOwnFile(
  host: Host,
  journal: Journal | undefined,
  path: string,
  data: Uint8Array | string,
): Promise<void> {
  const fsw = writePort(host)
  let id: number | undefined
  if (journal) {
    const exists = (await host.fs.stat(path)) !== undefined
    let original: string | null = null
    id = await journal.begin((n) => {
      original = exists ? journal.keep(n, posix.basename(path)) : null
      return { op: 'replace-file', path, original, sha1: sha1(host, data) }
    })
    if (original) await fsw.copyFile(path, original)
  }
  await fsw.writeFile(path, data)
  if (journal && id !== undefined) await journal.end(id, { op: 'replace-file' })
}

/** Rename a file or folder (never replacing anything), journaled; returns the journal id. */
export async function renameWithJournal(
  host: Host,
  journal: Journal | undefined,
  from: string,
  to: string,
): Promise<number | undefined> {
  const fsw = writePort(host)
  const id = await journal?.begin({ op: 'rename', from, to })
  await fsw.rename(from, to)
  if (journal && id !== undefined) await journal.end(id, { op: 'rename' })
  return id
}

/** Read a run's journal (unfinished operations included). */
export async function readJournal(host: Host, run: RunContext): Promise<JournalEntry[]> {
  let text: string
  try {
    text = new TextDecoder().decode(await host.fs.readFile(journalPath(run)))
  } catch {
    return []
  }
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as JournalEntry)
}
