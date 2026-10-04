/**
 * Report files of a collect/doctor run. CSVs use minimal quoting and CRLF line ends with a UTF-8
 * byte order mark, so Excel opens them correctly.
 */
import { type CsvValue, compareCodePoints, formatCsv, posix } from '@livesaver/core'
import type { Action, SetResult } from './collect.js'
import { MISSING_STATES, type Status } from './match.js'
import type { Probe } from './probe.js'
import {
  hintOf,
  KIND_NAMES,
  type Library,
  type LibraryKind,
  libraryGroups,
  type MissingGroup,
  missingGroups,
} from './sources.js'

/** What to do about a kind of source: what its libraries are told, taken together. */
const kindHint = (kind: LibraryKind, libs: readonly Library[]) =>
  hintOf({
    kind,
    samples: libs.reduce((n, lib) => n + lib.samples, 0),
    inLibrary: libs.reduce((n, lib) => n + lib.inLibrary, 0),
  })

const MAX_LISTED = 30

const STATUS_TEXT: Record<Status, string> = {
  ok: 'ok',
  kept: 'ok (pack/Live)',
  external: 'external',
  found: 'found',
  'not-found': 'not found',
  ambiguous: 'ambiguous',
  mismatch: 'different content',
}
const ACTION_TEXT: Record<Action, string> = {
  collected: 'collected',
  repaired: 'repaired',
  'path-updated': 'path updated',
}

export const REPORT_FILES = {
  samples: 'missing_samples.csv',
  sources: 'missing_sources.csv',
  projects: 'projects.csv',
  changes: 'changes.csv',
  overview: 'overview.md',
} as const

/** Rows as a CSV file (byte order mark, CRLF, minimal quoting). */
export function toCsv(rows: readonly (readonly CsvValue[])[]): string {
  return formatCsv(rows)
}

function display(path: string, base: string): string {
  const rel = posix.relpath(path, base)
  return rel === '.' ? posix.basename(path) : rel
}

function listing(items: readonly string[]): string {
  const sorted = [...items].sort(compareCodePoints)
  const text = sorted.slice(0, MAX_LISTED).join(' | ')
  return sorted.length > MAX_LISTED ? `${text} | … (+${sorted.length - MAX_LISTED})` : text
}

/** A number with thousands separators ("1,234"). */
function n(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

async function candidates(g: MissingGroup, probe: Probe): Promise<string> {
  const list = g.choice.candidates.slice(0, 10)
  if (g.status !== 'mismatch') return list.join(' | ')
  const items: string[] = []
  for (const path of list) {
    const s = await probe.stat(path)
    items.push(s ? `${path} (${s.size} bytes)` : path)
  }
  return items.join(' | ')
}

const TITLES: Record<LibraryKind, string> = {
  'ni-expansion': 'NI expansions (Native Access)',
  pack: 'Ableton packs',
  'core-library': 'Ableton Core Library',
  'old-project': 'Old project folders (from a previous computer)',
  'project-samples': "A project's own samples",
  'user-library': 'Old Ableton User Library',
  folder: 'Sample folders and libraries',
}

const GENERIC_WORDS = new Set(
  'KICK SNARE CLAP HAT HATS HIHAT HH OPENHH CLOSEDHH PERC SHAKER SHAKE TOM RIDE CRASH CYMBAL FX BASS LOOP VOX VOCAL SYNTH PAD LEAD CHORD DRUM DRUMS RIM SNAP AUDIO SAMPLE TOP BELLS CONGA BONGO FREEZE'.split(
    ' ',
  ),
)

/** Frequent file-name prefixes of missing samples (often the sample pack, e.g. "KSTH", "DAH"). */
export function namePrefixes(
  groups: readonly MissingGroup[],
  minimum = 20,
): [string, number, Set<string>, string[]][] {
  const found = new Map<string, [number, Set<string>, string[]]>()
  for (const g of groups) {
    const m = /^(?:\d+[\s_-]+)?([A-Za-z][A-Za-z0-9]{1,6})[\s_-]/.exec(posix.splitext(g.name)[0])
    if (!m || GENERIC_WORDS.has((m[1] as string).toUpperCase())) continue
    const key = (m[1] as string).toUpperCase()
    const entry = found.get(key) ?? [0, new Set<string>(), []]
    found.set(key, entry)
    entry[0]++
    for (const p of g.projects) entry[1].add(p)
    if (entry[2].length < 3) entry[2].push(g.name)
  }
  return [...found.entries()]
    .sort((a, b) => b[1][0] - a[1][0])
    .filter(([, [count]]) => count >= minimum)
    .map(([p, [count, projects, examples]]) => [p, count, projects, examples])
}

function mdTable(libs: readonly Library[], firstColumn: string, base: string): string[] {
  const lines = [
    `| ${firstColumn} | Samples | Sets | Projects | affected projects |`,
    '|---|---:|---:|---:|---|',
  ]
  for (const lib of libs) {
    const projects = [...lib.projects].map((p) => display(p, base)).sort(compareCodePoints)
    const shown =
      projects.slice(0, 4).join(', ') + (projects.length > 4 ? ` … (+${projects.length - 4})` : '')
    lines.push(
      `| ${lib.name.replaceAll('|', '/')} | ${n(lib.samples)} | ${n(lib.sets.size)} | ${n(lib.projects.size)} | ${shown} |`,
    )
  }
  return lines
}

function isComplete(r: SetResult): boolean {
  return !r.error && !MISSING_STATES.some((s) => r.counts[s] > 0)
}

function stamp(now: Date): string {
  const p = (x: number) => String(x).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`
}

function overview(
  results: readonly SetResult[],
  libraries: readonly Library[],
  groups: readonly MissingGroup[],
  base: string,
  now: Date,
): string {
  const byProject = new Map<string, SetResult[]>()
  for (const r of results) {
    const list = byProject.get(r.projectRoot) ?? []
    list.push(r)
    byProject.set(r.projectRoot, list)
  }
  const counts: Record<Status, number> = {
    ok: 0,
    kept: 0,
    external: 0,
    found: 0,
    'not-found': 0,
    ambiguous: 0,
    mismatch: 0,
  }
  for (const r of results) for (const [k, v] of Object.entries(r.counts)) counts[k as Status] += v
  const kinds = new Map<LibraryKind, Library[]>()
  for (const lib of libraries) {
    const list = kinds.get(lib.kind) ?? []
    list.push(lib)
    kinds.set(lib.kind, list)
  }
  const total = (k: LibraryKind) => (kinds.get(k) ?? []).reduce((s, lib) => s + lib.samples, 0)
  const order = [...kinds.keys()].sort((a, b) => total(b) - total(a))
  const missingRefs = MISSING_STATES.reduce((s, k) => s + counts[k], 0)
  const distinct = libraries.reduce((s, lib) => s + lib.samples, 0)

  const md: string[] = [
    '# Overview: missing samples in the Ableton projects',
    '',
    `As of: ${stamp(now)} · folder: \`${base}\``,
    '',
    '## Summary',
    '',
    '| | Count |',
    '|---|---:|',
    `| Projects | ${n(byProject.size)} |`,
    `| complete | ${n([...byProject.values()].filter((rs) => rs.every(isComplete)).length)} |`,
    `| Sets | ${n(results.length)} |`,
    `| complete | ${n(results.filter(isComplete).length)} |`,
    `| Sample references ok (in project or pack) | ${n(counts.ok + counts.kept)} |`,
    `| Sample references missing | ${n(missingRefs)} |`,
    `| Distinct missing samples | ${n(distinct)} |`,
    `| Missing sources (packs, expansions, folders …) | ${n(libraries.length)} |`,
    '',
    'References are counted per set, so one sample used in several sets counts several times.',
    '',
    '## By kind of source',
    '',
    '| Kind | Sources | missing samples | What to do |',
    '|---|---:|---:|---|',
  ]
  for (const k of order)
    md.push(
      `| ${TITLES[k]} | ${n((kinds.get(k) ?? []).length)} | ${n(total(k))} | ${kindHint(k, kinds.get(k) ?? [])} |`,
    )
  md.push('', '## Largest gaps', '')
  for (const [i, lib] of libraries.slice(0, 10).entries()) {
    md.push(
      `${i + 1}. **${lib.name}** (${TITLES[lib.kind]}): ${n(lib.samples)} samples in ${n(lib.projects.size)} projects – ${hintOf(lib)}`,
    )
  }
  md.push('', 'After getting them, run again; pass new folders with `--search <path>`.', '')
  const prefixes = namePrefixes(groups)
  if (prefixes.length > 0) {
    md.push(
      '## Frequent name prefixes',
      '',
      'Many sample packs mark their files with a short code, which often tells which pack a sample came from.',
      '',
      '| Prefix | missing samples | Projects | Examples |',
      '|---|---:|---:|---|',
    )
    for (const [prefix, count, projects, examples] of prefixes.slice(0, 12))
      md.push(`| ${prefix} | ${n(count)} | ${n(projects.size)} | ${examples.join(', ')} |`)
    md.push('')
  }
  const firstColumn: Partial<Record<LibraryKind, string>> = {
    'old-project': 'Project folder',
    'project-samples': 'Subfolder',
    folder: 'Folder',
  }
  for (const k of order) {
    const libs = kinds.get(k) ?? []
    const first = firstColumn[k] ?? 'Source'
    md.push(`## ${TITLES[k]}`, '', `*What to do:* ${kindHint(k, libs)}`, '')
    if (libs.length > 25) {
      md.push(...mdTable(libs.slice(0, 25), first, base))
      md.push('', `<details><summary>All ${libs.length}</summary>`, '')
      md.push(...mdTable(libs, first, base), '', '</details>')
    } else {
      md.push(...mdTable(libs, first, base))
    }
    md.push('')
  }
  md.push(
    '---',
    '',
    `Full lists with original paths, example files and all affected projects: \`${REPORT_FILES.sources}\` (per source) and \`${REPORT_FILES.samples}\` (per sample) in the same folder.`,
    '',
  )
  return md.join('\n')
}

/** All report files of a run, by file name. */
export async function buildReports(
  results: readonly SetResult[],
  base: string,
  probe: Probe,
  now = new Date(),
): Promise<Record<string, string>> {
  const groups = missingGroups(results)

  const samples: CsvValue[][] = [
    [
      'Status',
      'Kind',
      'File name',
      'Original path',
      'Source',
      'Pack',
      'Size (bytes)',
      'Sets',
      'Projects',
      'Project list',
      'Candidates',
    ],
  ]
  for (const g of groups) {
    samples.push([
      STATUS_TEXT[g.status],
      g.kind === 'device' ? 'Max device' : 'Sample',
      g.name,
      g.path,
      g.source,
      g.pack,
      g.size || '',
      g.sets.size,
      g.projects.size,
      listing([...g.projects].map((p) => display(p, base))),
      await candidates(g, probe),
    ])
  }

  const libraries = libraryGroups(groups)
  const sources: CsvValue[][] = [
    [
      'Kind',
      'Source',
      'missing samples',
      'not found',
      'different',
      'Sets',
      'Projects',
      'Original folders (most frequent)',
      'Examples',
      'What to do',
      'Project list',
    ],
  ]
  for (const lib of libraries) {
    const folders = [...lib.folders.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([f]) => f)
      .join(' | ')
    sources.push([
      KIND_NAMES[lib.kind],
      lib.name,
      lib.samples,
      lib.notFound,
      lib.samples - lib.notFound,
      lib.sets.size,
      lib.projects.size,
      folders,
      lib.examples.join(', '),
      hintOf(lib),
      listing([...lib.projects].map((p) => display(p, base))),
    ])
  }

  const projects: CsvValue[][] = [
    [
      'Project',
      'Set',
      'Live version',
      'Samples',
      'ok',
      'collected',
      'repaired',
      'not found',
      'ambiguous',
      'different',
      'Changes',
      'Status',
      'Backup',
    ],
  ]
  for (const r of results) {
    const c = r.counts
    let state: string
    if (r.error) state = `Error: ${r.error}`
    else if (r.skipped) state = 'complete (unchanged, skipped)'
    else state = MISSING_STATES.some((s) => c[s] > 0) ? 'incomplete' : 'complete'
    projects.push([
      display(r.projectRoot, base),
      posix.relpath(r.setPath, r.projectRoot),
      r.creator.replace('Ableton Live ', ''),
      Object.values(c).reduce((a, b) => a + b, 0),
      c.ok + c.kept,
      c.external,
      c.found,
      c['not-found'],
      c.ambiguous,
      c.mismatch,
      r.changes.length,
      state,
      r.backup,
    ])
  }

  const changes: CsvValue[][] = [
    [
      'Project',
      'Set',
      'Action',
      'Sample',
      'Old path',
      'New path (in project)',
      'Copied from',
      'Method',
      'Confidence',
    ],
  ]
  for (const r of results) {
    for (const ch of r.changes) {
      changes.push([
        display(r.projectRoot, base),
        posix.relpath(r.setPath, r.projectRoot),
        ACTION_TEXT[ch.action],
        ch.name,
        ch.oldPath,
        ch.newPath,
        ch.source,
        ch.method,
        ch.certain ? 'certain' : 'uncertain',
      ])
    }
  }

  return {
    [REPORT_FILES.samples]: toCsv(samples),
    [REPORT_FILES.overview]: overview(results, libraries, groups, base, now),
    [REPORT_FILES.sources]: toCsv(sources),
    [REPORT_FILES.projects]: toCsv(projects),
    [REPORT_FILES.changes]: toCsv(changes),
  }
}
