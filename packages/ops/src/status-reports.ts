/** Report files of a status run: sets.csv, the rating sheet's rows, plugins.csv, the overview. */
import {
  compareCodePoints,
  type Host,
  mergedTags,
  norm,
  type PluginRef,
  pluginCode,
  posix,
  pyFixed,
  type Tag,
} from '@livesaver/core'
import type { Availability, Inventory } from '@livesaver/plugins'
import { formatSheet } from './sheet.js'
import { sourceOf } from './sources.js'
import {
  bpm,
  decisionOf,
  duration,
  isSetComplete,
  type ProjectStatus,
  pluginsMissing,
  pluginsRosetta,
  type SetStatus,
  setName,
  setStage,
  splitComment,
  stageText,
  starsOf,
} from './status.js'
import type { StatusOutcome } from './status-apply.js'
import { managedTags, STAGE_KEYS, type StatusProfile } from './status-profile.js'
import { STATUS_FILES, WORDS } from './status-words.js'

// ------------------------------------------------------------------------------------ reports

const rel = (path: string, base: string) => {
  const r = posix.relpath(path, base)
  return r === '.' ? posix.basename(path) : r
}
const tagNames = (tags: readonly Tag[]) => tags.map(([n]) => n).join(', ')
const pluginList = (refs: readonly PluginRef[]) =>
  refs.map((r) => `${r.name} (${r.format})`).join(' | ')
const mb = (size: number) => pyFixed(size / 1e6, 0)

export interface SheetRow {
  readonly row: (string | number)[]
  readonly tags: string
  readonly comment: string
}

/** Rows of the rating sheet (furthest projects first), each with its tags and comment for the report. */
export function projectRows(
  projects: readonly ProjectStatus[],
  wanted: ReadonlyMap<string, { tags: Tag[]; comment: string }>,
  outcome: StatusOutcome,
  sheetBase: string,
  profile: StatusProfile,
): SheetRow[] {
  const w = WORDS
  const managed = managedTags(profile)
  const rows: { key: [number, string, string]; row: SheetRow }[] = []
  for (const p of projects) {
    if (!p.isProject || !p.main) continue
    const m = p.main
    const info = m.info
    const comment = outcome.comments.get(p.root) ?? wanted.get(p.root)?.comment ?? ''
    const tags = tagNames(mergedTags(p.tags, managed, wanted.get(p.root)?.tags ?? []))
    const row: (string | number)[] = [
      rel(posix.dirname(p.root), sheetBase),
      posix.basename(p.root),
      decisionOf(p, profile),
      starsOf(p, profile),
      splitComment(comment, profile)[1],
      stageText(setStage(m, profile), profile),
      setName(m),
      info?.hasArrangement ? duration(info.seconds) : '',
      info ? bpm(info.tempo) : '',
      p.sets.length,
      isSetComplete(m) ? w.yes : w.no,
      m.missingSamples.length,
      pluginList(pluginsMissing(m)),
      pluginList(pluginsRosetta(m)),
      p.duplicates.map(([o, c]) => `${rel(o, sheetBase)} (${c})`).join(' | '),
      p.exports.map((e) => posix.basename(e)).join(' | '),
      mb(p.size),
      info ? info.version : '',
    ]
    const stage = setStage(m, profile)
    const rank = stage === 'error' ? -1 : STAGE_KEYS.indexOf(stage)
    rows.push({
      key: [-rank, norm(String(row[0])), norm(String(row[1]))],
      row: { row, tags, comment },
    })
  }
  rows.sort(
    (a, b) =>
      a.key[0] - b.key[0] ||
      compareCodePoints(a.key[1], b.key[1]) ||
      compareCodePoints(a.key[2], b.key[2]),
  )
  return rows.map((r) => r.row)
}

export function sheetHeader(): string[] {
  return [...WORDS.sheetColumns]
}

interface PluginUsage {
  readonly ref: PluginRef
  readonly state: Availability
  readonly sets: Set<string>
  readonly projects: Set<string>
}

function pluginUsage(projects: readonly ProjectStatus[]): PluginUsage[] {
  const usage = new Map<string, PluginUsage>()
  for (const p of projects) {
    for (const s of p.sets) {
      for (const [k, { ref, state }] of s.plugins) {
        const entry = usage.get(k) ?? { ref, state, sets: new Set(), projects: new Set() }
        entry.sets.add(s.path)
        entry.projects.add(p.root)
        usage.set(k, entry)
      }
    }
  }
  return [...usage.values()]
}

export interface ReportOptions {
  readonly base: string
  readonly sheetBase?: string
  readonly inventory: Inventory
  readonly profile: StatusProfile
  readonly now?: Date
  /** Lists the folders next to the projects (for ZIP archives in the overview). */
  readonly zipFiles?: readonly string[]
}

/** The report files of a status run: name → content (CSV with byte order mark, Markdown). */
export function statusReports(
  projects: readonly ProjectStatus[],
  wanted: ReadonlyMap<string, { tags: Tag[]; comment: string }>,
  outcome: StatusOutcome,
  options: ReportOptions,
): Map<string, string> {
  const { base, profile, inventory } = options
  const sheetBase = options.sheetBase || base
  const w = WORDS
  const files = new Map<string, string>()

  const setRows: (string | number)[][] = [[...w.setsHeader]]
  for (const p of projects) {
    for (const s of p.sets) {
      const i = s.info
      const { tags, comment } = wanted.get(s.path) ?? { tags: [], comment: '' }
      const row: (string | number)[] = [rel(p.root, base), posix.relpath(s.path, p.root)]
      if (i) {
        const arranged = i.hasArrangement
        row.push(
          i.version,
          stageText(setStage(s, profile), profile),
          arranged ? duration(i.seconds) : '',
          arranged ? pyFixed(i.bars, 0) : '',
          arranged ? i.startBar : '',
          bpm(i.tempo),
          `${i.signature[0]}/${i.signature[1]}`,
          i.tracks.AudioTrack ?? 0,
          i.tracks.MidiTrack ?? 0,
          i.tracks.GroupTrack ?? 0,
          i.tracks.ReturnTrack ?? 0,
          i.namedTracks,
          i.arrangementClips,
          i.arrangementTracks,
          i.distinctBlocks,
          i.blocks,
          i.sessionClips,
          i.scenesUsed,
          i.scenes,
          i.locators.map((n) => n || w.noName).join(' | '),
          i.automated,
          i.masterDevices.join(', '),
        )
      } else row.push(...new Array<string>(22).fill(''))
      const sources = new Map<string, number>()
      for (const r of s.missingSamples) {
        const source = sourceOf(r)
        sources.set(source, (sources.get(source) ?? 0) + 1)
      }
      const common = [...sources].sort((a, b) => b[1] - a[1]) // stable: ties keep first-seen order
      row.push(
        s.missingSamples.length,
        common.map(([k, n]) => `${k} (${n})`).join(' | '),
        s.missingDevices.map((d) => d.name).join(' | '),
        pluginList(pluginsMissing(s)),
        pluginList(pluginsRosetta(s)),
        pluginList([...s.plugins.values()].map((x) => x.ref)),
        s.exports.map((e) => posix.basename(e)).join(' | '),
        tagNames(tags),
        outcome.comments.get(s.path) ?? comment,
        s.error,
      )
      setRows.push(row)
    }
  }
  files.set(w.files.sets, formatSheet(setRows[0] as string[], setRows.slice(1)))

  const rows = projectRows(projects, wanted, outcome, sheetBase, profile)
  files.set(
    w.files.projects,
    formatSheet(
      [...sheetHeader(), ...w.tagsComment],
      rows.map((r) => [...r.row, r.tags, r.comment]),
    ),
  )

  const usage = pluginUsage(projects).sort(
    (a, b) =>
      Number(a.state === 'installed') - Number(b.state === 'installed') ||
      b.projects.size - a.projects.size ||
      compareCodePoints(a.ref.name, b.ref.name),
  )
  const pluginRows = usage.map((u) => {
    const { state, found } = inventory.status(u.ref)
    const bundle = state === 'missing' ? inventory.failedBundle(u.ref) : ''
    return [
      u.ref.name,
      u.ref.format,
      pluginCode(u.ref),
      w.states[state],
      [...new Set(found.map((e) => e.path).filter((x) => x))].sort(compareCodePoints).join(' | '),
      found.length && !found.some((e) => e.scanned) ? w.yes : '',
      bundle ? w.failedHint(bundle) : '',
      u.sets.size,
      u.projects.size,
      [...u.projects]
        .map((r) => rel(r, base))
        .sort(compareCodePoints)
        .join(' | '),
    ]
  })
  files.set(w.files.plugins, formatSheet([...w.pluginsHeader], pluginRows))
  files.set(w.files.overview, overview(projects, usage, options))
  return files
}

function overview(
  projects: readonly ProjectStatus[],
  usage: readonly PluginUsage[],
  options: ReportOptions,
): string {
  const { base, profile } = options
  const now = options.now ?? new Date()
  const two = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}:${two(now.getMinutes())}`
  const real = projects.filter((p) => p.isProject && p.main)
  const sets = projects.flatMap((p) => p.sets)
  const rated = real.filter((p) => decisionOf(p, profile))
  const mains = real.map((p) => p.main as SetStatus)
  const count = <T>(items: readonly T[], f: (x: T) => unknown) => items.filter(f).length
  const stages = STAGE_KEYS.map((k) => profile.stages[k])
  const md: string[] = [
    '# Project status',
    '',
    `As of: ${stamp} · Folder: \`${base}\``,
    '',
    '## Summary',
    '',
    '| | Projects (main set) | Sets |',
    '|---|---:|---:|',
    `| total | ${real.length} | ${sets.length} |`,
    `| complete | ${count(mains, isSetComplete)} | ${count(sets, isSetComplete)} |`,
    `| samples missing | ${count(mains, (s) => s.missingSamples.length)} | ${count(sets, (s) => s.missingSamples.length)} |`,
    `| plug-ins or Max devices missing | ${count(mains, (s) => pluginsMissing(s).length || s.missingDevices.length)} | ${count(sets, (s) => pluginsMissing(s).length || s.missingDevices.length)} |`,
    `| Rosetta only | ${count(mains, (s) => pluginsRosetta(s).length)} | ${count(sets, (s) => pluginsRosetta(s).length)} |`,
    `| unreadable | ${count(mains, (s) => s.error)} | ${count(sets, (s) => s.error)} |`,
    `| rated | ${rated.length} of ${real.length} | |`,
    '',
    '## Progress per group (main set)',
    '',
    `| Group | ${stages.join(' | ')} | total |`,
    `|---|${'---:|'.repeat(stages.length + 1)}`,
  ]
  const groups = new Map<string, Map<string, number>>()
  const total = new Map<string, number>()
  for (const p of real) {
    const g = rel(posix.dirname(p.root), base)
    const stage = stageText(setStage(p.main as SetStatus, profile), profile)
    const c = groups.get(g) ?? new Map<string, number>()
    c.set(stage, (c.get(stage) ?? 0) + 1)
    groups.set(g, c)
    total.set(stage, (total.get(stage) ?? 0) + 1)
  }
  for (const g of [...groups.keys()].sort(compareCodePoints)) {
    const c = groups.get(g) as Map<string, number>
    const sum = [...c.values()].reduce((a, b) => a + b, 0)
    md.push(`| ${g} | ${stages.map((s) => c.get(s) ?? 0).join(' | ')} | ${sum} |`)
  }
  md.push(`| **all** | ${stages.map((s) => total.get(s) ?? 0).join(' | ')} | ${real.length} |`)
  md.push('', '## Decisions', '', '| Decision | Projects | Target folder |', '|---|---:|---|')
  const decisionNames = new Set(profile.decisions.map((d) => d.name))
  const decided = new Map<string, number>()
  for (const p of real)
    for (const [n] of p.tags) if (decisionNames.has(n)) decided.set(n, (decided.get(n) ?? 0) + 1)
  for (const d of profile.decisions)
    md.push(`| ${d.name} | ${decided.get(d.name) ?? 0} | ${d.folder} |`)
  md.push(`| open | ${real.length - rated.length} | stays where it is |`)
  const conflicts = real.filter((p) => p.tags.filter(([n]) => decisionNames.has(n)).length > 1)
  if (conflicts.length)
    md.push('', `More than one decision: ${conflicts.map((p) => rel(p.root, base)).join(', ')}`)
  const titles: [string, Availability][] = [
    ['Missing plug-ins', 'missing'],
    ['Plug-ins only with Rosetta', 'rosetta'],
  ]
  for (const [title, state] of titles) {
    const rows = usage
      .filter((u) => u.state === state)
      .sort(
        (a, b) => b.projects.size - a.projects.size || compareCodePoints(a.ref.name, b.ref.name),
      )
    if (!rows.length) continue
    md.push(
      '',
      `## ${title}`,
      '',
      '| Plug-in | Format | Projects | Sets |',
      '|---|---|---:|---:|',
      ...rows.map(
        (u) => `| ${u.ref.name} | ${u.ref.format} | ${u.projects.size} | ${u.sets.size} |`,
      ),
    )
  }
  const duplicates = real.filter((p) => p.duplicates.length)
  if (duplicates.length) {
    md.push('', '## Duplicate projects', '')
    for (const p of duplicates)
      md.push(
        `- ${rel(p.root, base)}: ${p.duplicates.map(([o, c]) => `${WORDS.alsoIn} ${rel(o, base)} (${c})`).join('; ')}`,
      )
  }
  md.push('', '## Cleanup', '')
  const copies = sets.filter((s) =>
    /(?<![\p{L}\p{N}_])copy(?![\p{L}\p{N}_])/u.test(norm(setName(s))),
  )
  const nested = projects.flatMap((p) => p.sets.filter((s) => posix.dirname(s.path) !== p.root))
  const zips = [...(options.zipFiles ?? [])]
  const list = (items: readonly string[]) => (items.length ? `: ${items.join(', ')}` : '')
  md.push(
    `- Sets with “copy” in their name: ${copies.length}${list(copies.slice(0, 15).map((s) => rel(s.path, base)))}`,
    `- Sets in subfolders of a project (e.g. \`Samples/\`): ${nested.length}${list(nested.slice(0, 15).map((s) => rel(s.path, base)))}`,
    `- ZIP archives next to the projects: ${zips.length}${list(zips.map((z) => rel(z, base)))}`,
    '',
    `Details: \`${STATUS_FILES.projects}\` (rating list), \`${STATUS_FILES.sets}\` (all measurements), \`${STATUS_FILES.plugins}\`.`,
    '',
  )
  return md.join('\n')
}

/** ZIP archives in the folders that hold the projects (for the overview). */
export async function zipFilesNextTo(
  host: Host,
  projects: readonly ProjectStatus[],
): Promise<string[]> {
  const found = new Set<string>()
  for (const dir of new Set(projects.map((p) => posix.dirname(p.root)))) {
    for (const e of (await host.fs.listDir(dir)) ?? [])
      if (e.name.toLowerCase().endsWith('.zip')) found.add(posix.join(dir, e.name))
  }
  return [...found].sort(compareCodePoints)
}

/** The console summary of a run. */
export function statusSummary(
  projects: readonly ProjectStatus[],
  outcome: StatusOutcome,
  apply: boolean,
  comments: boolean,
  profile: StatusProfile,
): string {
  const real = projects.filter((p) => p.isProject && p.main)
  const sets = projects.flatMap((p) => p.sets)
  const stageCount = new Map<string, number>()
  for (const p of real) {
    const s = stageText(setStage(p.main as SetStatus, profile), profile)
    stageCount.set(s, (stageCount.get(s) ?? 0) + 1)
  }
  const changed = apply ? 'changed' : 'that would change'
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  const completeProjects = real.filter((p) => isSetComplete(p.main as SetStatus)).length
  const lines = [
    apply ? '' : 'DRY RUN – nothing was changed (to do it: --apply)',
    `Projects: ${real.length}   Sets: ${sets.length}   complete: ${plural(completeProjects, 'project')}, ${plural(sets.filter(isSetComplete).length, 'set')}`,
    `Progress (main set): ${STAGE_KEYS.map((k) => `${profile.stages[k]} ${stageCount.get(profile.stages[k]) ?? 0}`).join(', ')}`,
    `Rated: ${real.filter((p) => decisionOf(p, profile)).length} of ${real.length}`,
    `Tags ${changed}: ${outcome.tagsChanged.length}`,
  ]
  if (comments) lines.push(`Comments ${changed}: ${outcome.commentsChanged.length}`)
  if (outcome.commentError) lines.push(`COMMENTS NOT SET: ${outcome.commentError}`)
  if (outcome.taken.length) {
    lines.push(
      `Taken over from the rating sheet${apply ? '' : ' (would be)'}: ${plural(outcome.taken.length, 'project')}`,
    )
    lines.push(...outcome.taken.slice(0, 20).map((l) => `  ${l}`))
  }
  lines.push(...outcome.sheetNotes.map((n) => `  – ${n}`))
  lines.push(...outcome.sheetProblems.map((p) => `  ! ${p}`))
  if (outcome.sheetWritten) lines.push(`Rating sheet: ${outcome.sheetWritten}`)
  if (outcome.sheetSkipped) lines.push(`RATING SHEET NOT REWRITTEN: ${outcome.sheetSkipped}`)
  lines.push(
    ...sets
      .filter((s) => s.error)
      .slice(0, 10)
      .map((s) => `ERROR ${s.path}: ${s.error}`),
  )
  return lines.filter((l) => l).join('\n')
}
