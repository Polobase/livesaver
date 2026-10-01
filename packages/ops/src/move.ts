/**
 * Move Live Sets that ended up in another song's project folder into a project of their own.
 *
 * The sets keep their file name and move together with their backups into the target project,
 * which is created next to the old one if needed. Every file of the old project that a moved set or
 * one of its backups uses is copied to the same place in the target, so the project-relative
 * references stay valid and the sets are not rewritten. Nothing is moved unless every reference
 * then finds the same content as before. If the target already holds a set of the same name, the
 * moved one is called "<Name> (from <old project>)".
 */
import {
  casefold,
  codePointLength,
  compareCodePoints,
  type FileRef,
  type Host,
  inProcessParser,
  nfc,
  norm,
  posix,
  pyStrip,
  type SetParser,
} from '@livesaver/core'
import { copyWithJournal, type Journal, renameWithJournal } from './apply.js'
import { findSets, PROJECT_MARKER, projectRootOf } from './collect.js'
import { type EnvConfig, Environment, isInside } from './env.js'
import { classify, resolveExisting } from './match.js'
import { MOVE_TEXT as T } from './move-text.js'
import { Probe } from './probe.js'

/** A set shares at most this share of its project files with the sets named like the project → other song. */
export const MAX_SHARED = 0.5
const VERSION_WORDS =
  'broken|copy|final|master|mix|mixdown|edit|new|old|test|v\\d+|version|fix|arr|arrangement|live|demo|draft|backup'

/** Sets of one project that move into `target`. */
export interface Move {
  readonly sourceRoot: string
  readonly target: string
  readonly newProject: boolean
  /** (old path, new path) */
  readonly sets: [string, string][]
  readonly backups: [string, string][]
  /** (file in the old project, destination) */
  readonly copies: [string, string][]
  /** Files the target already has (relative paths). */
  readonly reused: string[]
  /** Old project files no remaining set uses. */
  unusedAfter: string[]
  readonly problems: string[]
  done: boolean
  /** Bytes to copy. */
  copyBytes: number
}

function newMove(sourceRoot: string, target: string, newProject: boolean): Move {
  return {
    sourceRoot,
    target,
    newProject,
    sets: [],
    backups: [],
    copies: [],
    reused: [],
    unusedAfter: [],
    problems: [],
    done: false,
    copyBytes: 0,
  }
}

const stem = (path: string) => posix.splitext(posix.basename(path))[0]

export function projectName(root: string): string {
  return posix.basename(root).replace(/\s*Project$/, '')
}

export interface MoveContext {
  readonly host: Host
  readonly env: EnvConfig
  readonly parser?: SetParser
}

/** Live's backups of a set: <project>/Backup/<name> [YYYY-MM-DD HHMMSS].als (also "… 2.als"). */
export async function backupsOf(host: Host, setPath: string, probe: Probe): Promise<string[]> {
  const folder = posix.join(await projectRootOf(setPath, probe), 'Backup')
  const prefix = `${stem(setPath)} [`
  const entries = (await host.fs.listDir(folder)) ?? []
  return entries
    .map((e) => e.name)
    .filter(
      (n) =>
        n.startsWith(prefix) &&
        n.endsWith('.als') &&
        (!n.startsWith('.') || prefix.startsWith('.')),
    )
    .sort(compareCodePoints)
    .map((n) => posix.join(folder, n))
}

async function refsOf(ctx: MoveContext, path: string): Promise<readonly FileRef[]> {
  const parsed = await (ctx.parser ?? inProcessParser(ctx.host)).parse(path)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.refs
}

/** Files inside `root` the set uses: relative path → references to it. */
export async function usedFiles(
  ctx: MoveContext,
  setPath: string,
  setDir: string,
  root: string,
  env: Environment,
  probe: Probe,
): Promise<Map<string, FileRef[]>> {
  const files = new Map<string, FileRef[]>()
  for (const ref of await refsOf(ctx, setPath)) {
    if (!ref.name) continue
    const existing = await resolveExisting(ref, setDir, root, env, probe)
    if (existing && classify(existing, root, env) === 'project') {
      const rel = posix.relpath(existing, root)
      files.set(rel, [...(files.get(rel) ?? []), ref])
    }
  }
  return files
}

/** `path` is the file the references were made with (size and CRC as stored in the set). */
async function fitsFingerprint(
  path: string,
  refs: readonly FileRef[],
  probe: Probe,
): Promise<boolean> {
  const known = refs.filter((r) => r.size)
  if (!known.length) return false
  const print = await probe.fingerprint(path)
  return known.every((r) => print?.[0] === r.size && (!r.crc || print?.[1] === r.crc))
}

/** What moving `sets` (all from one project) into the project folder `target` takes. */
export async function planMove(
  ctx: MoveContext,
  sets: readonly string[],
  target: string,
): Promise<Move> {
  const t = T
  const { host } = ctx
  const probe = new Probe(host.fs, host.hash)
  const env = new Environment(ctx.env, probe)
  const roots = [...new Set(await Promise.all(sets.map((s) => projectRootOf(s, probe))))].sort(
    compareCodePoints,
  )
  const move = newMove(roots[0] as string, target, !(await probe.exists(target)))
  const root = move.sourceRoot
  if (roots.length > 1) {
    move.problems.push(t.differentProjects(roots.join(', ')))
    return move
  }
  if (sets.some((s) => posix.dirname(s) !== root)) move.problems.push(t.onlyTop)
  if (isInside(target, root) || isInside(root, target)) move.problems.push(t.nested)
  if (!move.newProject && !(await probe.isDir(posix.join(target, PROJECT_MARKER))))
    move.problems.push(t.notProject)
  if (move.problems.length) return move

  const taken = new Set<string>()
  for (const setPath of sets) {
    let next = posix.join(target, posix.basename(setPath))
    if ((await probe.exists(next)) || taken.has(norm(next)))
      next = posix.join(target, `${stem(setPath)} (${t.from} ${projectName(root)}).als`)
    if ((await probe.exists(next)) || taken.has(norm(next)))
      move.problems.push(t.nameTaken(posix.basename(setPath)))
    taken.add(norm(next))
    move.sets.push([setPath, next])
    for (const backup of await backupsOf(host, setPath, probe)) {
      const renamed = stem(next) + posix.basename(backup).slice(stem(setPath).length)
      const newBackup = posix.join(target, 'Backup', renamed)
      if ((await probe.exists(newBackup)) || taken.has(norm(newBackup)))
        move.problems.push(t.backupTaken(posix.basename(backup)))
      taken.add(norm(newBackup))
      move.backups.push([backup, newBackup])
    }
  }

  const needed = new Map<string, FileRef[]>()
  for (const [old] of [...move.sets, ...move.backups]) {
    for (const [rel, refs] of await usedFiles(ctx, old, posix.dirname(old), root, env, probe))
      needed.set(rel, [...(needed.get(rel) ?? []), ...refs])
  }
  for (const rel of [...needed.keys()].sort(compareCodePoints)) {
    const src = posix.join(root, rel)
    const dst = posix.join(target, rel)
    if (!(await probe.exists(dst))) move.copies.push([src, dst])
    else if (
      (await probe.sameContent(src, dst)) ||
      (await fitsFingerprint(dst, needed.get(rel) as FileRef[], probe))
    )
      move.reused.push(rel) // the same file, or the original the sets were made with
    else move.problems.push(t.otherFile(rel))
  }
  for (const [src] of move.copies) move.copyBytes += (await probe.stat(src))?.size ?? 0

  const moved = new Set([...move.sets, ...move.backups].map(([old]) => norm(old)))
  const remaining: string[] = []
  for (const s of await findSets([root], [], probe))
    if ((await projectRootOf(s, probe)) === root && !moved.has(norm(s))) remaining.push(s)
  for (const e of (await host.fs.listDir(posix.join(root, 'Backup'))) ?? []) {
    const b = posix.join(root, 'Backup', e.name)
    if (e.name.endsWith('.als') && !e.name.startsWith('.') && !moved.has(norm(b))) remaining.push(b)
  }
  const stillUsed = new Set<string>()
  for (const other of remaining) {
    try {
      for (const rel of (
        await usedFiles(ctx, other, posix.dirname(other), root, env, probe)
      ).keys())
        stillUsed.add(rel)
    } catch {
      for (const rel of needed.keys()) stillUsed.add(rel) // unreadable: assume it needs everything
    }
  }
  move.unusedAfter = [...needed.keys()].filter((r) => !stillUsed.has(r)).sort(compareCodePoints)
  return move
}

/** Every reference must find the same content from the new place as from the old one. */
export async function verifyMove(ctx: MoveContext, move: Move): Promise<string[]> {
  const t = T
  const probe = new Probe(ctx.host.fs, ctx.host.hash) // fresh: files were just copied
  const env = new Environment(ctx.env, probe)
  const problems: string[] = []
  for (const [old, next] of [...move.sets, ...move.backups]) {
    for (const ref of await refsOf(ctx, old)) {
      if (!ref.name) continue
      const before = await resolveExisting(ref, posix.dirname(old), move.sourceRoot, env, probe)
      if (!before) continue // was missing already
      const after = await resolveExisting(ref, posix.dirname(next), move.target, env, probe)
      let ok: boolean
      if (isInside(before, move.sourceRoot)) {
        const expected = posix.join(move.target, posix.relpath(before, move.sourceRoot))
        ok =
          Boolean(after) &&
          norm(after as string) === norm(expected) &&
          ((await probe.sameContent(before, after as string)) ||
            (await fitsFingerprint(after as string, [ref], probe)))
      } else {
        ok =
          Boolean(after) &&
          (norm(after as string) === norm(before) ||
            (await probe.sameContent(before, after as string)))
      }
      if (!ok) problems.push(t.wouldFind(posix.basename(old), ref.name, after ?? ''))
    }
  }
  return problems
}

/** Create the target, copy the files, check every reference, then move sets and backups. */
export async function executeMove(ctx: MoveContext, move: Move, journal?: Journal): Promise<void> {
  const t = T
  const { host } = ctx
  const fsw = host.write
  if (!fsw) throw new Error('this host cannot write files')
  const probe = new Probe(host.fs, host.hash)
  if (move.newProject) {
    await fsw.mkdirp(posix.join(move.target, PROJECT_MARKER))
    const info = posix.join(move.sourceRoot, PROJECT_MARKER)
    const names = ((await host.fs.listDir(info)) ?? []).map((e) => e.name).sort(compareCodePoints)
    for (const name of names) {
      const src = posix.join(info, name)
      if ((await probe.isFile(src)) && !name.startsWith('._'))
        await copyWithJournal(
          host,
          journal,
          probe,
          src,
          posix.join(move.target, PROJECT_MARKER, name),
        )
    }
  }
  for (const [src, dst] of move.copies) await copyWithJournal(host, journal, probe, src, dst)
  move.problems.push(...(await verifyMove(ctx, move)))
  if (move.problems.length) return // nothing moved; the copies do no harm
  for (const [old, next] of [...move.backups, ...move.sets]) {
    if (await host.fs.stat(next)) throw new Error(t.exists(next))
    await renameWithJournal(host, journal, old, next) // same volume: keeps the file and its dates
  }
  move.done = true
}

// ------------------------------------------------------------------------------------ suggestions

/** Song name of a set: lower case, without version endings ("night drive 1001" → "night drive"). */
export function family(name: string): string {
  let text = casefold(nfc(stem(name)))
  text = pyStrip(text.replace(/\[.*?\]|\(.*?\)/g, ' ').replace(/[_\-.]+/g, ' '))
  const versionEnd = new RegExp(`\\s+(\\d+[a-z]?|[a-z]|${VERSION_WORDS})$`)
  let previous: string | undefined
  while (previous !== text) {
    previous = text
    text = pyStrip(text.replace(versionEnd, ''))
    text = pyStrip(text.replace(/(?<=\p{L})\d+[a-z]?$/u, '')) // "Sunrise101" → "sunrise"
  }
  return text || casefold(stem(name))
}

/** Project name for a song: the shortest set name without version endings, spelled as in the file. */
export function displayName(sets: readonly string[]): string {
  let name = stem(sets[0] as string)
  for (const s of sets.slice(1))
    if (codePointLength(stem(s)) < codePointLength(name)) name = stem(s)
  return pyStrip(name.replace(/(\s+(\d+[a-zA-Z]?|[a-zA-Z]))+$/, '')) || name
}

function related(a: string, b: string): boolean {
  const x = a.replaceAll(' ', '')
  const y = b.replaceAll(' ', '')
  const [short, long] = codePointLength(y) < codePointLength(x) ? [y, x] : [x, y]
  return x === y || (codePointLength(short) >= 3 && long.startsWith(short))
}

export interface MoveSuggestion {
  readonly set: string
  readonly target: string
  readonly note: string
}

/** Songs saved into another song's project: few shared files with the sets named like the project. */
export async function suggestMoves(
  ctx: MoveContext,
  folders: readonly string[],
  excludes: readonly string[],
): Promise<MoveSuggestion[]> {
  const t = T
  const probe = new Probe(ctx.host.fs, ctx.host.hash)
  const env = new Environment(ctx.env, probe)
  const byRoot = new Map<string, string[]>()
  for (const s of await findSets(folders, excludes, probe)) {
    const root = await projectRootOf(s, probe)
    byRoot.set(root, [...(byRoot.get(root) ?? []), s])
  }
  const suggestions: MoveSuggestion[] = []
  for (const root of [...byRoot.keys()].sort(compareCodePoints)) {
    const families = new Map<string, string[]>()
    for (const s of byRoot.get(root) as string[]) {
      if (posix.dirname(s) !== root) continue
      const f = family(s)
      families.set(f, [...(families.get(f) ?? []), s])
    }
    const projectFamily = family(projectName(root))
    const main = [...families.keys()].filter((f) => related(f, projectFamily))
    if (families.size < 2 || !main.length) continue
    const files = new Map<string, Set<string>>()
    for (const members of families.values()) {
      for (const s of members) {
        try {
          files.set(s, new Set((await usedFiles(ctx, s, root, root, env, probe)).keys()))
        } catch {
          files.set(s, new Set())
        }
      }
    }
    const mainFiles = new Set(
      main.flatMap((f) => (families.get(f) as string[]).flatMap((s) => [...(files.get(s) ?? [])])),
    )
    for (const [name, members] of families) {
      if (main.includes(name)) continue
      const own = new Set(members.flatMap((s) => [...(files.get(s) ?? [])]))
      const shared = [...own].filter((f) => mainFiles.has(f)).length
      if (own.size && shared / own.size >= MAX_SHARED) continue // a version of the main song under another name
      const target = posix.join(posix.dirname(root), `${displayName(members)} Project`)
      let note = t.note(shared, own.size, projectName(root))
      if (await probe.exists(target)) note += t.targetExists
      for (const s of [...members].sort(compareCodePoints))
        suggestions.push({ set: s, target, note })
    }
  }
  return suggestions
}

export function failedMove(sourceRoot: string, target: string, error: string): Move {
  const m = newMove(sourceRoot, target, false)
  m.problems.push(T.unreadable(error))
  return m
}
