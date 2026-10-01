/**
 * Mark every project and Live Set in Finder: how far it got and whether it is complete. Tag names
 * come from a `StatusProfile` (configurable).
 *
 * Each set gets one progress tag (Empty … Elaborated), completeness tags (Complete, Samples
 * missing, Plugins missing, Rosetta) and a one-line Finder comment with the facts. Each project
 * folder gets the same for its main set, plus Export and Duplicate. Only livesaver's own tags are
 * replaced; the user's tags (decisions, stars) stay untouched, and so does everything the user
 * writes in a comment after "‖".
 */
import {
  type FileRef,
  type PluginRef,
  posix,
  pyG,
  pyRound,
  pyRoundTo,
  pyStrip,
  type SetInfo,
  type Tag,
} from '@livesaver/core'
import type { Availability } from '@livesaver/plugins'
import type { StageKey, StatusProfile, TagKey } from './status-profile.js'
import { WORDS } from './status-words.js'

// ------------------------------------------------------------------------------------ model

export interface SetStatus {
  readonly path: string
  readonly root: string
  /** Modification time in seconds (Python's float `st_mtime`). */
  mtime: number
  info: SetInfo | undefined
  error: string
  readonly missingSamples: FileRef[]
  /** Max for Live devices. */
  readonly missingDevices: FileRef[]
  /** Availability per plug-in, in order of appearance (key: format, id and name). */
  readonly plugins: Map<string, { readonly ref: PluginRef; readonly state: Availability }>
  exports: string[]
}

export interface ProjectStatus {
  readonly root: string
  readonly sets: SetStatus[]
  /** Has "Ableton Project Info"; otherwise only its sets are marked. */
  readonly isProject: boolean
  main: SetStatus | undefined
  exports: string[]
  /** (other copy of the project, comparison) */
  duplicates: [string, string][]
  size: number
  /** Current Finder tags. */
  tags: Tag[]
}

export type StageName = StageKey | 'error'

export function stageOf(info: SetInfo, profile: StatusProfile): StageKey {
  const t = profile.thresholds
  if (info.empty) return 'empty'
  if (!info.hasArrangement) return 'session'
  if (info.seconds < t.sketchSeconds || info.distinctBlocks < t.minBlocks) return 'sketch'
  if (info.distinctBlocks >= t.elaboratedBlocks && info.automated >= t.elaboratedAutomation)
    return 'elaborated'
  return 'arranged'
}

export function setStage(s: SetStatus, profile: StatusProfile): StageName {
  return s.info ? stageOf(s.info, profile) : 'error'
}

export function stageText(stage: StageName, profile: StatusProfile): string {
  return stage === 'error' ? profile.error : profile.stages[stage]
}

const pluginsIn = (s: SetStatus, state: Availability) =>
  [...s.plugins.values()].filter((p) => p.state === state).map((p) => p.ref)

export const pluginsMissing = (s: SetStatus) => pluginsIn(s, 'missing')
export const pluginsRosetta = (s: SetStatus) => pluginsIn(s, 'rosetta')

export function isSetComplete(s: SetStatus): boolean {
  return !(
    s.error ||
    s.missingSamples.length ||
    s.missingDevices.length ||
    pluginsMissing(s).length ||
    pluginsRosetta(s).length
  )
}

export function setName(s: SetStatus): string {
  return posix.splitext(posix.basename(s.path))[0]
}

export function decisionOf(p: ProjectStatus, profile: StatusProfile): string {
  const names = new Set(profile.decisions.map((d) => d.name))
  return p.tags
    .map(([n]) => n)
    .filter((n) => names.has(n))
    .join(', ')
}

export function starsOf(p: ProjectStatus, profile: StatusProfile): string {
  const names = new Set(profile.stars)
  return p.tags
    .map(([n]) => n)
    .filter((n) => names.has(n))
    .join(', ')
}

// ------------------------------------------------------------------------------------ tags and comments

/** "3:12" or "1:02:03" (Python's `round`, so exact halves go to the even second). */
export function duration(seconds: number): string {
  const total = pyRound(seconds)
  const hours = Math.floor(total / 3600)
  const rest = total - hours * 3600
  const minutes = Math.floor(rest / 60)
  const secs = rest - minutes * 60
  const two = (n: number) => String(n).padStart(2, '0')
  return hours ? `${hours}:${two(minutes)}:${two(secs)}` : `${minutes}:${two(secs)}`
}

/** The tempo rounded to two decimals, without trailing zeros ("120", "128.5"). */
export function bpm(tempo: number): string {
  return pyG(pyRoundTo(tempo, 2))
}

function tempoText(info: SetInfo): string {
  const text = `${bpm(info.tempo)} BPM`
  const [n, d] = info.signature
  return n === 4 && d === 4 ? text : `${text} ${n}/${d}`
}

export function names(items: readonly string[], max: number): string[] {
  const unique = [...new Set(items.filter((i) => i))]
  return [...unique.slice(0, max), ...(unique.length > max ? [`+${unique.length - max}`] : [])]
}

const deviceName = (ref: FileRef) => ref.name.replace(/\.amxd$/i, '')

/** "complete", or what is missing and what only loads under Rosetta. */
export function missingText(s: SetStatus, profile: StatusProfile): string {
  if (s.error) return ''
  const w = WORDS
  const items: string[] = []
  if (s.missingSamples.length) items.push(w.samples(s.missingSamples.length))
  items.push(
    ...names(
      [...s.missingDevices.map(deviceName), ...pluginsMissing(s).map((r) => r.name)],
      profile.maxNames,
    ),
  )
  const parts = items.length ? [`${w.missing}: ${items.join(', ')}`] : []
  const rosetta = pluginsRosetta(s)
  if (rosetta.length)
    parts.push(
      `Rosetta: ${names(
        rosetta.map((r) => `${r.name} (${r.format})`),
        profile.maxNames,
      ).join(', ')}`,
    )
  return parts.length ? parts.join(profile.field) : w.complete
}

export function completenessTags(s: SetStatus): TagKey[] {
  if (s.error) return []
  const tags: TagKey[] = []
  if (s.missingSamples.length) tags.push('samplesMissing')
  if (s.missingDevices.length || pluginsMissing(s).length) tags.push('pluginsMissing')
  if (pluginsRosetta(s).length) tags.push('rosetta')
  return tags.length ? tags : ['complete']
}

function coloured(profile: StatusProfile, stage: StageName, keys: readonly TagKey[]): Tag[] {
  return [
    [stageText(stage, profile), 0] as const,
    ...keys.map((k) => [profile.tags[k], profile.colours[k] ?? 0] as const),
  ]
}

export function setTags(s: SetStatus, profile: StatusProfile): Tag[] {
  if (s.error) return []
  return coloured(profile, setStage(s, profile), [
    ...completenessTags(s),
    ...(s.exports.length ? (['export'] as const) : []),
  ])
}

function lengthText(info: SetInfo, profile: StatusProfile): string {
  const w = WORDS
  return (
    duration(info.seconds) + (info.seconds > profile.thresholds.overlongSeconds ? w.overlong : '')
  )
}

export function setComment(s: SetStatus, profile: StatusProfile): string {
  const w = WORDS
  if (s.error) return `${profile.error}${profile.field}${s.error}`
  const info = s.info as SetInfo
  const parts = [stageText(setStage(s, profile), profile)]
  if (info.hasArrangement) parts.push(lengthText(info, profile))
  else if (info.sessionClips) parts.push(w.sessionClips(info.sessionClips, info.scenesUsed))
  parts.push(
    tempoText(info),
    w.tracks(info.contentTracks),
    `Live ${info.version}`,
    missingText(s, profile),
  )
  if (s.exports.length) parts.push(profile.tags.export)
  return parts.filter((p) => p).join(profile.field)
}

export function projectTags(p: ProjectStatus, profile: StatusProfile): Tag[] {
  const main = p.main
  if (!main || main.error) return []
  return coloured(profile, setStage(main, profile), [
    ...completenessTags(main),
    ...(p.exports.length ? (['export'] as const) : []),
    ...(p.duplicates.length ? (['duplicate'] as const) : []),
  ])
}

/** The other copy of a project, as short as possible: "Studio" or "Night Drive Project copy". */
function where(other: string, root: string): string {
  const group = posix.relpath(posix.dirname(other), posix.commonpath([root, other]))
  if (posix.basename(other) === posix.basename(root)) return group
  return group === '.' ? posix.basename(other) : `${group}/${posix.basename(other)}`
}

export function projectComment(p: ProjectStatus, profile: StatusProfile): string {
  const w = WORDS
  const main = p.main
  if (!main) return ''
  if (main.error) return `${profile.error}${profile.field}${w.mainSet(setName(main))} ${main.error}`
  const info = main.info as SetInfo
  const mainText =
    w.mainSet(setName(main)) + (info.hasArrangement ? ` ${lengthText(info, profile)}` : '')
  const parts = [
    stageText(setStage(main, profile), profile),
    mainText,
    w.sets(p.sets.length),
    missingText(main, profile),
    ...p.duplicates.map(
      ([other, comparison]) => `${w.alsoIn} ${where(other, p.root)} (${comparison})`,
    ),
  ]
  if (p.exports.length)
    parts.push(
      `${profile.tags.export}: ${names(
        p.exports.map((e) => posix.basename(e)),
        profile.maxNames,
      ).join(', ')}`,
    )
  return parts.filter((part) => part).join(profile.field)
}

/** Whether a comment (part) was written by livesaver. */
export function isAuto(text: string, profile: StatusProfile): boolean {
  return [...Object.values(profile.stages), profile.error].some(
    (prefix) => text === prefix || text.startsWith(prefix + profile.field),
  )
}

/**
 * (automatic part, own notes) of a Finder comment. Notes stand after "‖"; a comment without "‖"
 * that livesaver did not write counts as a note, so nothing the user wrote gets lost.
 */
export function splitComment(text: string, profile: StatusProfile): [auto: string, notes: string] {
  const t = pyStrip(text ?? '')
  const cut = t.indexOf(profile.noteSeparator)
  if (cut >= 0) {
    const head = pyStrip(t.slice(0, cut))
    const notes = pyStrip(t.slice(cut + profile.noteSeparator.length))
    if (head && !isAuto(head, profile)) return ['', pyStrip(`${head} ${notes}`)]
    return [head, notes]
  }
  return isAuto(t, profile) ? [t, ''] : ['', t]
}

export function mergeComment(current: string, auto: string, profile: StatusProfile): string {
  const [, notes] = splitComment(current, profile)
  return notes ? `${auto} ${profile.noteSeparator} ${notes}` : auto
}
