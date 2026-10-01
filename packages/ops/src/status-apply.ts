/**
 * Applying a status run: the entries typed into the rating sheet are taken over, livesaver's tags
 * and comments are set, and the sheet is written anew.
 */
import {
  compareCodePoints,
  FinderAccessError,
  type Host,
  mergedTags,
  norm,
  posix,
  pyStrip,
  sameTags,
  type Tag,
} from '@livesaver/core'
import { type Journal, setComments, writeOwnFile, setTags as writeTags } from './apply.js'
import { Probe } from './probe.js'
import {
  type Cells,
  formatSheet,
  keyOf,
  lockFileOf,
  parseDecision,
  parseSnapshot,
  parseStars,
  readSheet,
  serializeSnapshot,
  typedCells,
} from './sheet.js'
import { mergeComment, type ProjectStatus } from './status.js'
import {
  type InspectOptions,
  inspectProjects,
  planned,
  readCommentAttr,
  readTags,
} from './status-inspect.js'
import { managedTags, type StatusProfile } from './status-profile.js'
import { projectRows, sheetHeader, statusReports, zipFilesNextTo } from './status-reports.js'
import { WORDS } from './status-words.js'

// ------------------------------------------------------------------------------------ applying

export interface StatusOutcome {
  tagsChanged: string[]
  commentsChanged: string[]
  /** path → comment after the run */
  comments: Map<string, string>
  commentError: string
  /** What was taken over from the rating sheet. */
  taken: string[]
  sheetProblems: string[]
  /** e.g. rows of projects that were deleted */
  sheetNotes: string[]
  /** Path of the rewritten rating sheet. */
  sheetWritten: string
  /** Why it was not rewritten. */
  sheetSkipped: string
}

export function emptyOutcome(): StatusOutcome {
  return {
    tagsChanged: [],
    commentsChanged: [],
    comments: new Map(),
    commentError: '',
    taken: [],
    sheetProblems: [],
    sheetNotes: [],
    sheetWritten: '',
    sheetSkipped: '',
  }
}

function finderMessage(error: unknown): string {
  const w = WORDS
  if (error instanceof FinderAccessError) {
    if (error.kind === 'permission') return w.permission
    if (error.kind === 'mismatch') return w.mismatch(error.detail)
    return w.scriptFailed(error.detail)
  }
  return (error as Error).message ?? String(error)
}

/**
 * Set the decisions and stars typed into the rating sheet as tags; returns the typed notes per
 * folder. `exported`: rows (normalised "Group/Project") the last run wrote; if such a project is
 * gone, it was deleted or renamed on purpose and its row is simply dropped.
 */
export async function takeOver(
  host: Host,
  projects: readonly ProjectStatus[],
  cells: ReadonlyMap<string, Partial<Cells>>,
  sheetBase: string,
  apply: boolean,
  outcome: StatusOutcome,
  profile: StatusProfile,
  exported: ReadonlySet<string> = new Set(),
  journal?: Journal,
): Promise<Map<string, string>> {
  const w = WORDS
  const decisions = new Map(profile.decisions.map((d) => [d.name, d]))
  const stars = new Set(profile.stars)
  const byPath = new Map<string, ProjectStatus>()
  for (const p of projects) if (p.isProject) byPath.set(norm(p.root), p)
  const byName = new Map<string, ProjectStatus[]>()
  for (const p of byPath.values()) {
    const k = norm(posix.basename(p.root))
    byName.set(k, [...(byName.get(k) ?? []), p])
  }
  const notes = new Map<string, string>()
  for (const [key, typed] of [...cells].sort(([a], [b]) => compareCodePoints(a, b))) {
    let project = byPath.get(norm(posix.normpath(posix.join(sheetBase, key))))
    if (!project) {
      // moved since the sheet was written: find it by its folder name
      const same = byName.get(norm(posix.basename(key))) ?? []
      project = same.length === 1 ? same[0] : undefined
    }
    if (!project && exported.has(norm(key))) {
      outcome.sheetNotes.push(w.sheetGone(key))
      continue
    }
    if (!project) {
      outcome.sheetProblems.push(w.sheetNotFound(key))
      continue
    }
    let tags = [...project.tags]
    const done: string[] = []
    if (typed.decision !== undefined) {
      const decision = parseDecision(typed.decision, [...decisions.keys()])
      if (decision === undefined) {
        outcome.sheetProblems.push(
          w.unclearDecision(key, typed.decision, [...decisions.keys()].join(', ')),
        )
      } else {
        tags = [
          ...tags.filter(([n]) => !decisions.has(n)),
          ...(decision ? [[decision, decisions.get(decision)?.colour ?? 0] as const] : []),
        ]
        done.push(w.decisionTaken(decision))
      }
    }
    if (typed.stars !== undefined) {
      const value = parseStars(typed.stars)
      if (value === undefined) outcome.sheetProblems.push(w.unclearStars(key, typed.stars))
      else {
        tags = [...tags.filter(([n]) => !stars.has(n)), ...(value ? [[value, 0] as const] : [])]
        done.push(w.starsTaken(value))
      }
    }
    if (typed.note !== undefined) {
      notes.set(project.root, typed.note)
      done.push(w.noteTaken)
    }
    const changed =
      tags.length !== project.tags.length ||
      tags.some((t, i) => t[0] !== project.tags[i]?.[0] || t[1] !== project.tags[i]?.[1])
    if (changed) {
      outcome.tagsChanged.push(project.root)
      if (apply) {
        // the user's tags first: Finder shows their colour in front
        const rating = tags.filter(([n]) => decisions.has(n) || stars.has(n))
        const rest = (await readTags(host, project.root)).filter(
          ([n]) => !decisions.has(n) && !stars.has(n),
        )
        await writeTags(host, journal, project.root, [...rating, ...rest])
      }
      project.tags = tags
    }
    if (done.length) outcome.taken.push(`${key}: ${done.join(', ')}`)
  }
  return notes
}

export interface MarkOptions {
  readonly apply: boolean
  /** Also set Finder comments (default true). */
  readonly comments?: boolean
  /** Replaces the user's note in the comment of these paths (typed into the rating sheet). */
  readonly notes?: ReadonlyMap<string, string>
  readonly outcome?: StatusOutcome
  readonly journal?: Journal
  readonly log?: (message: string) => void
}

/**
 * Set livesaver's tags and comments (only with `apply`); the user's tags and notes stay. Comments
 * are read through Finder when applying, else from the extended attribute (dry run).
 */
export async function mark(
  host: Host,
  wanted: ReadonlyMap<string, { tags: Tag[]; comment: string }>,
  profile: StatusProfile,
  options: MarkOptions,
): Promise<StatusOutcome> {
  const outcome = options.outcome ?? emptyOutcome()
  const managed = managedTags(profile)
  for (const [path, { tags }] of wanted) {
    const current = await readTags(host, path)
    const next = mergedTags(current, managed, tags)
    if (!sameTags(next, current)) {
      if (!outcome.tagsChanged.includes(path)) outcome.tagsChanged.push(path)
      if (options.apply) await writeTags(host, options.journal, path, next)
    }
  }
  if (options.comments === false) {
    for (const path of wanted.keys()) outcome.comments.set(path, await readCommentAttr(host, path))
    return outcome
  }
  const paths = [...wanted.keys()]
  const current = new Map<string, string>()
  if (!options.apply) {
    for (const p of paths) current.set(p, await readCommentAttr(host, p))
  } else {
    if (!host.finder) {
      outcome.commentError = WORDS.noFinder
      return outcome
    }
    try {
      options.log?.(`comments: ${paths.length}`)
      const read = await host.finder.read(paths)
      // A folder moved outside Finder loses the comment Finder shows, not the attribute that moved along
      for (const p of paths) current.set(p, read.get(p) || (await readCommentAttr(host, p)))
    } catch (error) {
      outcome.commentError = finderMessage(error)
      return outcome
    }
  }
  const notes = options.notes ?? new Map<string, string>()
  const changes = new Map<string, { before: string; after: string }>()
  for (const path of paths) {
    const auto = (wanted.get(path) as { comment: string }).comment
    const before = current.get(path) ?? ''
    const note = notes.get(path)
    const next =
      note !== undefined
        ? auto + (note ? ` ${profile.noteSeparator} ${note}` : '')
        : mergeComment(before, auto, profile)
    outcome.comments.set(path, next)
    if (next !== pyStrip(before)) changes.set(path, { before, after: next })
  }
  outcome.commentsChanged = [...changes.keys()]
  if (options.apply && changes.size) {
    try {
      await setComments(host, options.journal, changes)
    } catch (error) {
      outcome.commentError = finderMessage(error)
    }
  }
  return outcome
}

// ------------------------------------------------------------------------------------ run

export interface SheetOptions {
  /** The rating sheet (CSV). */
  readonly path: string
  /** Where livesaver remembers what it wrote into the sheet. */
  readonly snapshot: string
}

export interface StatusRunOptions extends InspectOptions {
  readonly apply: boolean
  readonly comments?: boolean
  readonly sheet?: SheetOptions
  readonly journal?: Journal
  readonly now?: Date
  readonly log?: (message: string) => void
}

export interface StatusResult {
  readonly projects: ProjectStatus[]
  readonly outcome: StatusOutcome
  readonly wanted: Map<string, { tags: Tag[]; comment: string }>
  /** Report files: name → content. */
  readonly reports: Map<string, string>
  readonly base: string
}

/** A text file as UTF-8, or Windows-1252 if it is not valid UTF-8 (Excel's "CSV"). */
export async function readTextFile(host: Host, path: string): Promise<string | undefined> {
  try {
    const data = await host.fs.readFile(path)
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(data)
    } catch {
      return new TextDecoder('windows-1252').decode(data) // saved by Excel as "CSV (Windows)"
    }
  } catch {
    return undefined
  }
}

/** What the last run wrote into the rating sheet (empty without a snapshot file). */
export async function readSnapshot(host: Host, path: string): Promise<Map<string, Cells>> {
  return parseSnapshot(await readTextFile(host, path))
}

/** A whole status run, without writing report files. */
export async function statusRun(host: Host, options: StatusRunOptions): Promise<StatusResult> {
  const { profile, apply } = options
  const w = WORDS
  const comments = options.comments !== false
  const probe = options.probe ?? new Probe(host.fs, host.hash)
  let base = posix.commonpath(options.targets)
  if ((await host.fs.stat(base))?.isFile) base = posix.dirname(base)
  const sheet = options.sheet
  const sheetBase = sheet ? posix.dirname(sheet.path) : base
  const outcome = emptyOutcome()
  let cells = new Map<string, Partial<Cells>>()
  let exported = new Set<string>()
  if (sheet) {
    if (await host.fs.stat(lockFileOf(sheet.path))) outcome.sheetSkipped = w.sheetOpen
    else {
      const snapshot = await readSnapshot(host, sheet.snapshot)
      const text = await readTextFile(host, sheet.path)
      cells = typedCells(text === undefined ? new Map() : readSheet(text), snapshot)
      exported = new Set([...snapshot.keys()].map(norm))
    }
  }
  const projects = await inspectProjects(host, { ...options, probe })
  const notes = await takeOver(
    host,
    projects,
    cells,
    sheetBase,
    apply,
    outcome,
    profile,
    exported,
    options.journal,
  )
  if (notes.size && !comments) outcome.sheetProblems.push(w.notesWithoutComments)
  const wanted = planned(projects, profile)
  await mark(host, wanted, profile, {
    apply,
    comments,
    notes: comments ? notes : new Map(),
    outcome,
    ...(options.journal ? { journal: options.journal } : {}),
    ...(options.log ? { log: options.log } : {}),
  })
  const managed = managedTags(profile)
  for (const p of projects) {
    // decisions as they are now
    if (!p.isProject) continue
    p.tags = apply
      ? await readTags(host, p.root)
      : mergedTags(p.tags, managed, wanted.get(p.root)?.tags ?? [])
  }
  const reports = statusReports(projects, wanted, outcome, {
    base,
    sheetBase,
    inventory: options.inventory,
    profile,
    ...(options.now ? { now: options.now } : {}),
    zipFiles: await zipFilesNextTo(host, projects),
  })
  if (sheet && apply && !outcome.sheetSkipped) {
    if (outcome.sheetProblems.length || outcome.commentError) outcome.sheetSkipped = w.sheetKept
    else {
      const rows = projectRows(projects, wanted, outcome, sheetBase, profile)
      await writeOwnFile(
        host,
        options.journal,
        sheet.path,
        formatSheet(
          sheetHeader(),
          rows.map((r) => r.row),
        ),
      )
      const snapshot = new Map<string, Cells>()
      for (const { row } of rows)
        snapshot.set(keyOf(String(row[0]), String(row[1])), {
          decision: String(row[2]),
          stars: String(row[3]),
          note: String(row[4]),
        })
      await writeOwnFile(host, options.journal, sheet.snapshot, serializeSnapshot(snapshot))
      outcome.sheetWritten = sheet.path
    }
  }
  return { projects, outcome, wanted, reports, base }
}
