/**
 * Reverse an applied run from its journal, newest change first. Every step checks that the thing
 * still is exactly what livesaver made of it; otherwise someone changed it since, and it is left
 * alone:
 * - a rewritten set is restored only if it still holds what livesaver wrote;
 * - a renamed file or folder goes back only if its old place is still free;
 * - tags, comments and files livesaver maintains (rating sheet) are restored only if unchanged;
 * - a copied file goes to the Trash only if its content is unchanged and no set of its project
 *   uses it any more.
 */
import {
  COMMENT_ATTR,
  decodeComment,
  type FsWrite,
  type Host,
  posix,
  TAGS_ATTR,
} from '@livesaver/core'
import { fromHex, type JournalEntry, type RunContext, readJournal } from './apply.js'
import { projectRootOf } from './collect.js'
import { doctor } from './doctor.js'
import type { EnvConfig } from './env.js'
import { Probe } from './probe.js'

export interface UndoReport {
  /** Sets restored to their original content. */
  readonly restored: string[]
  readonly alreadyRestored: string[]
  /** Things changed since the run (left alone). */
  readonly changedSince: string[]
  readonly trashed: string[]
  readonly stillUsed: string[]
  readonly unfinished: string[]
  /** Files and folders moved back to where they were. */
  readonly renamedBack: string[]
  readonly tagsRestored: string[]
  readonly commentsRestored: string[]
  /** Files livesaver maintains (rating sheet, snapshot) restored or removed. */
  readonly filesRestored: string[]
  readonly problems: string[]
}

async function sha1Of(host: Host, path: string): Promise<string | undefined> {
  try {
    const h = host.hash.sha1()
    h.update(await host.fs.readFile(path))
    return h.hex()
  } catch {
    return undefined
  }
}

const hexOf = (data: Uint8Array | undefined) =>
  data ? Array.from(data, (b) => b.toString(16).padStart(2, '0')).join('') : null

type Begin = Extract<JournalEntry, { t: 'begin' }>
type BeginOf<Op extends Begin['op']> = Extract<Begin, { op: Op }>

function describe(e: Begin): string {
  switch (e.op) {
    case 'copy':
      return e.destination
    case 'write-set':
      return e.set
    case 'rename':
      return `${e.from} → ${e.to}`
    case 'comments':
      return e.items.map((i) => i.path).join(', ')
    default:
      return e.path
  }
}

export async function undoRun(host: Host, run: RunContext, env: EnvConfig): Promise<UndoReport> {
  const fsw = host.write as FsWrite | undefined
  if (!fsw) throw new Error('this host cannot write files')
  const entries = await readJournal(host, run)
  const ended = new Set(entries.filter((e) => e.t === 'end').map((e) => e.id))
  const undone = new Set(entries.filter((e) => e.t === 'undo').map((e) => e.id))
  const report: UndoReport = {
    restored: [],
    alreadyRestored: [],
    changedSince: [],
    trashed: [],
    stillUsed: [],
    unfinished: [],
    renamedBack: [],
    tagsRestored: [],
    commentsRestored: [],
    filesRestored: [],
    problems: [],
  }
  const log = (id: number, result: string) =>
    fsw.appendDurable(
      posix.join(run.dir, 'journal.jsonl'),
      JSON.stringify({ t: 'undo', id, result, at: new Date().toISOString() }),
    )
  const exists = async (path: string) =>
    ((await host.fs.lstat?.(path)) ?? (await host.fs.stat(path))) !== undefined

  const begins = entries.filter((e): e is Begin => e.t === 'begin')
  for (const e of begins) if (!ended.has(e.id)) report.unfinished.push(describe(e))
  const todo = begins.filter((e) => ended.has(e.id) && !undone.has(e.id))

  // Everything but copies, newest first.
  for (const e of [...todo].reverse()) {
    try {
      if (e.op === 'write-set') await undoSet(e)
      else if (e.op === 'rename') await undoRename(e)
      else if (e.op === 'tags') await undoTags(e)
      else if (e.op === 'comments') await undoComments(e)
      else if (e.op === 'replace-file') await undoFile(e)
    } catch (error) {
      report.problems.push(`${describe(e)}: ${(error as Error).message}`)
    }
  }

  async function undoSet(e: BeginOf<'write-set'>) {
    const current = await sha1Of(host, e.set)
    const original = await sha1Of(host, e.original)
    if (current === e.sha1 && original) {
      await fsw?.replaceFile(e.set, await host.fs.readFile(e.original))
      report.restored.push(e.set)
      await log(e.id, 'restored')
    } else if (current !== undefined && current === original) {
      report.alreadyRestored.push(e.set)
    } else {
      report.changedSince.push(e.set)
      await log(e.id, 'changed-since')
    }
  }

  async function undoRename(e: BeginOf<'rename'>) {
    if ((await exists(e.to)) && !(await exists(e.from))) {
      await fsw?.rename(e.to, e.from)
      report.renamedBack.push(e.from)
      await log(e.id, 'renamed-back')
    } else if ((await exists(e.from)) && !(await exists(e.to))) {
      report.alreadyRestored.push(e.from)
    } else {
      report.changedSince.push(e.to)
      await log(e.id, 'changed-since')
    }
  }

  async function undoTags(e: BeginOf<'tags'>) {
    const xattr = host.xattr
    if (!xattr) throw new Error('this host cannot set Finder tags')
    if (!(await exists(e.path))) return // renamed back or gone: nothing to restore here
    const current = hexOf(await xattr.get(e.path, TAGS_ATTR))
    if (current === e.after) {
      if (e.before === null) await xattr.remove(e.path, TAGS_ATTR)
      else await xattr.set(e.path, TAGS_ATTR, fromHex(e.before))
      report.tagsRestored.push(e.path)
      await log(e.id, 'restored')
    } else if (current !== e.before) {
      report.changedSince.push(e.path)
      await log(e.id, 'changed-since')
    }
  }

  async function undoComments(e: BeginOf<'comments'>) {
    const finder = host.finder
    if (!finder) throw new Error('this host cannot set Finder comments')
    const items = []
    for (const i of e.items) if (await exists(i.path)) items.push(i)
    if (!items.length) return
    const current = await finder.read(items.map((i) => i.path))
    const back = new Map<string, string>()
    for (const i of items) {
      const now = current.get(i.path) || decodeComment(await host.xattr?.get(i.path, COMMENT_ATTR))
      if (now === i.after) back.set(i.path, i.before)
      else if (now !== i.before) report.changedSince.push(i.path)
    }
    if (back.size) {
      await finder.write(back)
      report.commentsRestored.push(...back.keys())
    }
    await log(e.id, back.size ? 'restored' : 'changed-since')
  }

  async function undoFile(e: BeginOf<'replace-file'>) {
    const current = await sha1Of(host, e.path)
    if (current !== e.sha1) {
      if (current !== undefined) report.changedSince.push(e.path)
      await log(e.id, 'changed-since')
      return
    }
    if (e.original) await fsw?.writeFile(e.path, await host.fs.readFile(e.original))
    else await fsw?.trash(e.path)
    report.filesRestored.push(e.path)
    await log(e.id, 'restored')
  }

  // Copies: find which files the projects' sets use now, then trash what nobody uses.
  const copies = todo.filter((e): e is BeginOf<'copy'> => e.op === 'copy')
  if (copies.length > 0) {
    const probe = new Probe(host.fs, host.hash)
    const roots = [
      ...new Set(await Promise.all(copies.map((c) => projectRootOf(c.destination, probe)))),
    ]
    const used = new Set<string>()
    for (const root of roots) {
      const check = await doctor(host, { targets: [root], searchRoots: [], env })
      for (const r of check.results) for (const f of r.files) used.add(posix.normpath(f))
    }
    const endOf = new Map(
      entries.filter((e) => e.t === 'end' && e.op === 'copy').map((e) => [e.id, e]),
    )
    for (const c of copies) {
      const end = endOf.get(c.id) as Extract<JournalEntry, { t: 'end'; op: 'copy' }> | undefined
      if (used.has(posix.normpath(c.destination))) {
        report.stillUsed.push(c.destination)
        continue
      }
      const now = await sha1Of(host, c.destination)
      if (now === undefined) continue
      if (end && now !== end.sha1) {
        report.stillUsed.push(c.destination)
        continue
      }
      await fsw.trash(c.destination)
      report.trashed.push(c.destination)
      if (end?.asd && (await host.fs.stat(`${c.destination}.asd`))) {
        await fsw.trash(`${c.destination}.asd`)
        report.trashed.push(`${c.destination}.asd`)
      }
      await log(c.id, 'trashed')
    }
  }
  return report
}
