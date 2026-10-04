/**
 * Reverse an applied run from its journal, newest change first. Every step checks that the thing
 * still is exactly what livesaver made of it; otherwise someone changed it since, and it is left
 * alone:
 * - a rewritten set is restored only if it still holds what livesaver wrote;
 * - a renamed file or folder goes back only if its old place is still free;
 * - tags, comments and files livesaver maintains (rating sheet) are restored only if unchanged;
 * - a copied file goes to the Trash only if its content is unchanged and no set uses it that
 *   was changed since the run. A set that is again what it was before the run does not count:
 *   the file did not exist then, so the set can only have expected it (a fix puts a file where
 *   its set looks for it, if it can).
 *
 * A step that is found taken back already (by an undo that could not note it, or by hand) is
 * noted as such, so that the run reads as undone.
 */
import {
  COMMENT_ATTR,
  decodeComment,
  type FsWrite,
  type Host,
  norm,
  posix,
  TAGS_ATTR,
} from '@livesaver/core'
import { fromHex, type JournalEntry, type RunContext, readJournal } from './apply.js'
import { projectRootOf } from './collect.js'
import { doctor } from './doctor.js'
import { type EnvConfig, isInside } from './env.js'
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
      // With its content the set gets its old date back: the original was kept with it.
      const kept = await host.fs.stat(e.original)
      await fsw?.replaceFile(e.set, await host.fs.readFile(e.original), kept?.mtimeNs)
      report.restored.push(e.set)
      await log(e.id, 'restored')
    } else if (current !== undefined && current === original) {
      report.alreadyRestored.push(e.set)
      await log(e.id, 'restored')
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
      await log(e.id, 'renamed-back')
    } else {
      report.changedSince.push(e.to)
      await log(e.id, 'changed-since')
    }
  }

  async function undoTags(e: BeginOf<'tags'>) {
    const xattr = host.xattr
    if (!xattr) throw new Error('this host cannot set Finder tags')
    if (!(await exists(e.path))) {
      await log(e.id, 'gone') // renamed back or gone: nothing to restore here
      return
    }
    const current = hexOf(await xattr.get(e.path, TAGS_ATTR))
    if (current === e.after) {
      if (e.before === null) await xattr.remove(e.path, TAGS_ATTR)
      else await xattr.set(e.path, TAGS_ATTR, fromHex(e.before))
      report.tagsRestored.push(e.path)
      await log(e.id, 'restored')
    } else if (current !== e.before) {
      report.changedSince.push(e.path)
      await log(e.id, 'changed-since')
    } else {
      await log(e.id, 'restored') // they are what they were before already
    }
  }

  async function undoComments(e: BeginOf<'comments'>) {
    const finder = host.finder
    if (!finder) throw new Error('this host cannot set Finder comments')
    const items = []
    for (const i of e.items) if (await exists(i.path)) items.push(i)
    if (!items.length) {
      await log(e.id, 'gone')
      return
    }
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

  // Copies: a copy stays only for a set that uses it and was changed since the run.
  const copies = todo.filter((e): e is BeginOf<'copy'> => e.op === 'copy')
  if (copies.length > 0) {
    const probe = new Probe(host.fs, host.hash)
    /** Paths as macOS compares them: a set may spell a file's name in another case or form. */
    const key = (path: string) => norm(posix.normpath(path))
    /** The sets the run rewrote, each with the original that was kept of it. */
    const written = new Map<string, BeginOf<'write-set'>>()
    for (const e of begins)
      if (e.op === 'write-set' && ended.has(e.id) && !written.has(key(e.set)))
        written.set(key(e.set), e)
    const asBefore = async (e: BeginOf<'write-set'>) => {
      const original = await sha1Of(host, e.original)
      return original !== undefined && original === (await sha1Of(host, e.set))
    }
    // The projects to look at are those of the run's sets. (Asked of the copy, a set that lies
    // in no project folder would not be found: its copies lie below it, and nothing above
    // them says where the project begins.)
    const roots = new Set<string>()
    for (const e of written.values()) roots.add(await projectRootOf(e.set, probe))
    for (const c of copies) {
      if (![...roots].some((root) => isInside(c.destination, root)))
        roots.add(await projectRootOf(c.destination, probe))
    }
    const used = new Set<string>()
    /** Projects whose copies all stay: a set of the run there changed and cannot be read. */
    const guarded: string[] = []
    for (const root of roots) {
      if (!copies.some((c) => isInside(c.destination, root))) continue
      const check = await doctor(host, { targets: [root], searchRoots: [], env })
      for (const r of check.results) {
        const mine = written.get(key(r.setPath))
        // What a set uses that is as it was before the run, it only expected back then.
        if (mine && (await asBefore(mine))) continue
        if (mine && r.error) guarded.push(root)
        for (const f of r.files) used.add(key(f))
      }
    }
    const endOf = new Map(
      entries.filter((e) => e.t === 'end' && e.op === 'copy').map((e) => [e.id, e]),
    )
    for (const c of copies) {
      const end = endOf.get(c.id) as Extract<JournalEntry, { t: 'end'; op: 'copy' }> | undefined
      const asd = `${c.destination}.asd`
      try {
        const now = await sha1Of(host, c.destination)
        if (now === undefined) {
          // Taken away already. The analysis file the run copied with it is of no use alone.
          if (end?.asd && (await host.fs.stat(asd))) {
            await fsw.trash(asd)
            report.trashed.push(asd)
          }
          await log(c.id, 'gone')
          continue
        }
        if (used.has(key(c.destination)) || guarded.some((root) => isInside(c.destination, root))) {
          report.stillUsed.push(c.destination)
          continue
        }
        if (end && now !== end.sha1) {
          // No longer the file the run copied: someone's, and left alone for good.
          report.changedSince.push(c.destination)
          await log(c.id, 'changed-since')
          continue
        }
        await fsw.trash(c.destination)
        report.trashed.push(c.destination)
        if (end?.asd && (await host.fs.stat(asd))) {
          await fsw.trash(asd)
          report.trashed.push(asd)
        }
        await log(c.id, 'trashed')
      } catch (error) {
        // One file that cannot be moved (a Trash that is out of reach) must not end the undo.
        report.problems.push(`${c.destination}: ${(error as Error).message}`)
      }
    }
  }
  return report
}
