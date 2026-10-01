/**
 * Sort whole project folders into status folders, following the decision tag in Finder.
 *
 * Target folders below the projects folder come from the profile's decisions ("1 In Progress",
 * "2 Ideas", …); folders marked `keepGroup` keep the old group ("4 Archive/Old/2014/…"). A folder
 * is only renamed as a whole (same volume: sets stay byte-identical, tags move along). Nothing is
 * ever replaced or deleted: an existing target, a set elsewhere that uses files of the folder, or a
 * reference that finds another file afterwards stops the move of that project (the rename is
 * taken back).
 */
import {
  compareCodePoints,
  csvRecords,
  decodeTags,
  type Host,
  inProcessParser,
  nfc,
  norm,
  type ParsedSet,
  posix,
  type SetParser,
  TAGS_ATTR,
  type Tag,
} from '@livesaver/core'
import { type Journal, renameWithJournal, setComments } from './apply.js'
import type { CompleteSets } from './cache.js'
import { findSets, PROJECT_MARKER, projectRootOf } from './collect.js'
import { type EnvConfig, Environment, isInside } from './env.js'
import { mapLimited } from './file-index.js'
import { resolveExisting } from './match.js'
import { Probe } from './probe.js'
import { formatSheet } from './sheet.js'
import type { StatusProfile } from './status-profile.js'

export interface Relocation {
  readonly source: string
  readonly target: string
  readonly decision: string
  readonly problems: string[]
  done: boolean
}

export function relocation(source: string, target: string, decision = ''): Relocation {
  return { source, target, decision, problems: [], done: false }
}

const LEFTOVERS = new Set(['.DS_Store', 'Desktop.ini', 'Icon\r', '.localized'])

const T = {
  planColumns: ['Project', 'Decision', 'Target', 'Note'],
  several: 'several decisions – please set only one',
  targetExists: 'target exists already – enter another name in “Target”',
  sameTargetAs: (o: string) => `same target as ${o} – enter another name in “Target”`,
  noProject: 'no Live project (any more) at this place',
  exists: 'target exists already – nothing is ever replaced',
  nested: 'target and project lie inside each other',
  sameTarget: (o: string) => `same target as ${o}`,
  otherVolume: 'target is on another volume',
  uses: (set: string, file: string) => `${set} uses files from it (${file})`,
  wouldFind: (set: string, name: string, found: string) =>
    `${set}: ${name} would then find ${found || 'no file any more'} – renamed back`,
  aborted: (e: string) => `stopped while moving: ${e}`,
  reportColumns: ['Project', 'Decision', 'Target', 'Status'],
  error: 'Error',
  moved: 'moved',
  ready: 'ready',
} as const

/** Report and plan file names of `reorg`. */
export const REORG_FILES = { report: 'reorg.csv', plan: 'reorg_plan.csv' } as const

// ------------------------------------------------------------------------------------ suggestions

async function isDir(host: Host, path: string): Promise<boolean> {
  return (await host.fs.stat(path))?.isDirectory ?? false
}

/** Project folders (with "Ableton Project Info") below `folders`; projects nested in one move with it. */
export async function projectRoots(
  host: Host,
  folders: readonly string[],
  excludes: readonly string[] = [],
): Promise<string[]> {
  const roots: string[] = []
  const walk = async (dir: string): Promise<void> => {
    if (excludes.some((e) => isInside(dir, e))) return
    const entries = (await host.fs.listDir(dir)) ?? []
    const dirs = entries.filter((e) => e.isDirectory)
    if (dirs.some((e) => e.name === PROJECT_MARKER)) {
      roots.push(dir)
      return
    }
    const next = dirs
      .filter((e) => e.name !== 'Backup' && !e.name.startsWith('.') && !e.isSymlink)
      .map((e) => e.name)
      .sort(compareCodePoints)
    for (const name of next) await walk(posix.join(dir, name))
  }
  for (const folder of folders) if (await isDir(host, folder)) await walk(folder)
  return roots.sort(compareCodePoints)
}

/** Where a project sits now, without a status folder: "Old/2014", "Remixes", "" (directly in base). */
export function groupOf(root: string, base: string, profile: StatusProfile): string {
  if (!isInside(root, base)) return posix.basename(posix.dirname(root))
  const rel = posix.relpath(posix.dirname(root), base)
  let parts = rel === '.' ? [] : rel.split('/')
  const folders = new Set(profile.decisions.map((d) => d.folder))
  if (parts.length && folders.has(parts[0] as string)) parts = parts.slice(1)
  return parts.join('/')
}

export function targetFor(
  root: string,
  decision: string,
  base: string,
  profile: StatusProfile,
): string {
  const d = profile.decisions.find((x) => x.name === decision)
  if (!d) throw new Error(`unknown decision ${decision}`)
  const group = d.keepGroup ? groupOf(root, base, profile) : ''
  return group
    ? posix.join(base, d.folder, group, posix.basename(root))
    : posix.join(base, d.folder, posix.basename(root))
}

export interface PlanRow {
  readonly project: string
  readonly decision: string
  readonly target: string
  readonly note: string
}

async function tagsOf(host: Host, path: string): Promise<Tag[]> {
  try {
    return decodeTags(await host.xattr?.get(path, TAGS_ATTR))
  } catch {
    return []
  }
}

/** One row per rated project that is not yet where its decision says. */
export async function suggestReorg(
  host: Host,
  folders: readonly string[],
  base: string,
  profile: StatusProfile,
  excludes: readonly string[] = [],
): Promise<PlanRow[]> {
  const t = T
  const names = new Set(profile.decisions.map((d) => d.name))
  const rows: PlanRow[] = []
  const taken = new Map<string, string>()
  for (const root of await projectRoots(host, folders, excludes)) {
    const decisions = (await tagsOf(host, root)).map(([n]) => n).filter((n) => names.has(n))
    if (!decisions.length) continue
    if (new Set(decisions).size > 1) {
      rows.push({ project: root, decision: decisions.join(', '), target: '', note: t.several })
      continue
    }
    const target = targetFor(root, decisions[0] as string, base, profile)
    if (norm(target) === norm(root)) continue
    const notes: string[] = []
    if (await host.fs.stat(target)) notes.push(t.targetExists)
    const other = taken.get(norm(target))
    if (other !== undefined) notes.push(t.sameTargetAs(other))
    else taken.set(norm(target), root)
    rows.push({ project: root, decision: decisions[0] as string, target, note: notes.join('; ') })
  }
  return rows
}

/** The plan file for people to check and edit. */
export function formatReorgPlan(rows: readonly PlanRow[]): string {
  return formatSheet(
    [...T.planColumns],
    rows.map((r) => [r.project, r.decision, r.target, r.note]),
  )
}

/** Moves of a plan file; `resolve` makes paths absolute (~ etc.). */
export function parseReorgPlan(text: string, resolve: (path: string) => string): Relocation[] {
  const { records } = csvRecords(text)
  const moves: Relocation[] = []
  for (const r of records) {
    const project = r.Project
    const target = r.Target
    if (project && target)
      moves.push(relocation(resolve(project), resolve(target), r.Decision ?? ''))
  }
  return moves
}

// ------------------------------------------------------------------------------------ checks

async function existingParent(host: Host, path: string): Promise<string> {
  let p = path
  while (!(await host.fs.stat(p)) && posix.dirname(p) !== p) p = posix.dirname(p)
  return p
}

async function parsedRefs(parser: SetParser, path: string) {
  const parsed: ParsedSet = await parser.parse(path)
  return parsed.ok ? parsed.refs : undefined
}

export interface ReorgContext {
  readonly host: Host
  readonly env: EnvConfig
  readonly profile: StatusProfile
  readonly parser?: SetParser
}

/** Record why a move must not happen: existing target, shared files, other volume … */
export async function checkReorg(
  ctx: ReorgContext,
  moves: readonly Relocation[],
  scanRoots: readonly string[],
): Promise<void> {
  const { host } = ctx
  const t = T
  const targets = new Map<string, string>()
  for (const m of moves) {
    if (!(await isDir(host, posix.join(m.source, PROJECT_MARKER)))) m.problems.push(t.noProject)
    if (await host.fs.stat(m.target)) m.problems.push(t.exists)
    if (isInside(m.target, m.source) || isInside(m.source, m.target)) m.problems.push(t.nested)
    const other = targets.get(norm(m.target))
    if (other !== undefined) m.problems.push(t.sameTarget(other))
    else targets.set(norm(m.target), m.source)
    const source = await host.fs.stat(m.source)
    if (source) {
      const parent = await host.fs.stat(await existingParent(host, m.target))
      if (parent && parent.dev !== source.dev) m.problems.push(t.otherVolume)
    }
  }
  const moving = moves.filter((m) => !m.problems.length)
  const probe = new Probe(host.fs, host.hash)
  const env = new Environment(ctx.env, probe)
  const scanned = await findSets(scanRoots, [], probe)
  for (const m of moving) {
    for (const s of await findSets([m.source], [], probe))
      if (!scanRoots.some((r) => isInside(s, r))) scanned.push(s)
  }
  const parser = ctx.parser ?? inProcessParser(host)
  const refsOf = await mapLimited(scanned, 16, (s) => parsedRefs(parser, s))
  for (const [i, setPath] of scanned.entries()) {
    const refs = refsOf[i]
    if (!refs) continue
    const owner = moving.find((m) => isInside(setPath, m.source))
    const root = await projectRootOf(setPath, probe)
    const setDir = posix.dirname(setPath)
    for (const ref of refs) {
      const found = ref.name ? await resolveExisting(ref, setDir, root, env, probe) : undefined
      if (!found) continue
      for (const m of moving) {
        if (m !== owner && isInside(found, m.source)) {
          const problem = t.uses(setPath, posix.basename(found))
          if (!m.problems.includes(problem)) m.problems.push(problem)
        }
      }
    }
  }
}

/** Where every reference of the sets in `folder` resolves: "set (relative)\0key" → file. */
async function references(ctx: ReorgContext, folder: string): Promise<Map<string, string>> {
  const probe = new Probe(ctx.host.fs, ctx.host.hash) // fresh: the folder may just have moved
  const env = new Environment(ctx.env, probe)
  const parser = ctx.parser ?? inProcessParser(ctx.host)
  const found = new Map<string, string>()
  for (const setPath of await findSets([folder], [], probe)) {
    const refs = await parsedRefs(parser, setPath)
    if (!refs) continue
    const root = await projectRootOf(setPath, probe)
    for (const ref of refs) {
      if (!ref.name) continue
      const path = await resolveExisting(ref, posix.dirname(setPath), root, env, probe)
      if (path) found.set(`${posix.relpath(setPath, folder)}\u0000${ref.key}`, path)
    }
  }
  return found
}

/** Where `path` is after renaming `source` to `target` (paths in a set may be composed differently). */
export function movedPath(path: string, source: string, target: string): string {
  if (!isInside(path, source)) return path
  return posix.normpath(posix.join(target, posix.relpath(nfc(path), nfc(source))))
}

/** Rename the folder; take it back unless every reference finds the same file afterwards. */
export async function executeRelocation(
  ctx: ReorgContext,
  m: Relocation,
  journal?: Journal,
): Promise<void> {
  const t = T
  const fsw = ctx.host.write
  if (!fsw) throw new Error('this host cannot write files')
  const before = await references(ctx, m.source)
  const id = await renameWithJournal(ctx.host, journal, m.source, m.target)
  const after = await references(ctx, m.target)
  for (const [key, path] of before) {
    const expected = movedPath(path, m.source, m.target)
    const now = after.get(key)
    if (now === undefined || norm(now) !== norm(expected)) {
      await fsw.rename(m.target, m.source)
      if (journal && id !== undefined) await journal.undone(id, 'renamed-back')
      m.problems.push(
        t.wouldFind(key.split('\u0000')[0] as string, posix.basename(path), now ?? ''),
      )
      return
    }
  }
  m.done = true
}

async function holdsNothing(host: Host, path: string): Promise<boolean> {
  const entries = await host.fs.listDir(path)
  if (!entries) return false
  for (const e of entries) {
    const full = posix.join(path, e.name)
    if (e.isDirectory) {
      if (
        (await isDir(host, posix.join(full, PROJECT_MARKER))) ||
        !(await holdsNothing(host, full))
      )
        return false
    } else if (!LEFTOVERS.has(e.name) && !e.name.startsWith('._')) return false
  }
  return true
}

/** Top-most folders without any content left (to delete by hand); projects are skipped. */
export async function emptyFolders(host: Host, folders: readonly string[]): Promise<string[]> {
  const found: string[] = []
  for (const folder of folders) {
    const entries = (await host.fs.listDir(folder)) ?? []
    for (const name of entries.map((e) => e.name).sort(compareCodePoints)) {
      const full = posix.join(folder, name)
      if (name.startsWith('.') || !(await isDir(host, full))) continue
      if (await isDir(host, posix.join(full, PROJECT_MARKER))) continue
      if (await holdsNothing(host, full)) found.push(full)
      else found.push(...(await emptyFolders(host, [full])))
    }
  }
  return found
}

export interface ReorgRunOptions {
  readonly base: string
  readonly apply: boolean
  readonly journal?: Journal
  /** livesaver's list of complete sets, kept valid for moved projects. */
  readonly cache?: CompleteSets
  readonly log?: (message: string) => void
}

/** Check the plan and, with `apply`, move the folders. False if nothing could be started. */
export async function runReorg(
  ctx: ReorgContext,
  moves: readonly Relocation[],
  options: ReorgRunOptions,
): Promise<{ started: boolean; commentError: string; pruned: number }> {
  const t = T
  const { host } = ctx
  const scanRoots = [
    ...new Set([
      options.base,
      ...moves.filter((m) => !isInside(m.source, options.base)).map((m) => posix.dirname(m.source)),
    ]),
  ].sort(compareCodePoints)
  await checkReorg(ctx, moves, scanRoots)
  if (!options.apply) return { started: true, commentError: '', pruned: 0 }
  const ready = moves.filter((m) => !m.problems.length)
  let comments = new Map<string, string>()
  if (ready.length) {
    if (!host.finder) return { started: false, commentError: 'Finder', pruned: 0 }
    try {
      // Finder keeps a folder's comment in the parent's .DS_Store: carry it over by hand
      comments = await host.finder.read(ready.map((m) => m.source))
    } catch (error) {
      return { started: false, commentError: (error as Error).message, pruned: 0 }
    }
  }
  for (const m of ready) {
    try {
      await executeRelocation(ctx, m, options.journal)
    } catch (error) {
      m.problems.push(t.aborted((error as Error).message))
    }
    if (m.done) options.cache?.remap((p) => movedPath(p, m.source, m.target))
  }
  const restore = new Map<string, { before: string; after: string }>()
  for (const m of ready) {
    const c = comments.get(m.source)
    if (m.done && c) restore.set(m.target, { before: '', after: c })
  }
  let commentError = ''
  if (restore.size) {
    try {
      await setComments(host, options.journal, restore)
    } catch (error) {
      commentError = (error as Error).message
    }
  }
  const pruned = options.cache
    ? await options.cache.prune(async (p) => (await host.fs.stat(p)) !== undefined)
    : 0
  return { started: true, commentError, pruned }
}

function rel(path: string, base: string): string {
  return posix.relpath(path, base)
}

export function reorgReport(moves: readonly Relocation[], base: string): string {
  return formatSheet(
    [...T.reportColumns],
    moves.map((m) => [
      rel(m.source, base),
      m.decision,
      rel(m.target, base),
      m.problems.length ? `${T.error}: ${m.problems.join(' | ')}` : m.done ? T.moved : T.ready,
    ]),
  )
}

export function reorgSummary(moves: readonly Relocation[], apply: boolean, base: string): string {
  const lines = [apply ? '' : 'DRY RUN – nothing was changed (to do it: --apply)']
  for (const m of moves) {
    const state = m.problems.length ? 'ERROR' : m.done ? T.moved : T.ready
    lines.push(`[${state}] ${rel(m.source, base)} → ${rel(m.target, base)}`)
    lines.push(...m.problems.map((p) => `    ! ${p}`))
  }
  const ok = apply ? moves.filter((m) => m.done) : moves.filter((m) => !m.problems.length)
  lines.push(`Projects ${apply ? 'moved' : 'ready'}: ${ok.length} of ${moves.length}`)
  return lines.filter((l) => l).join('\n')
}
