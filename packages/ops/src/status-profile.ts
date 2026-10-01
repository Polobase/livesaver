/**
 * The vocabulary of `status`, `reorg` and the rating sheet: stage and tag names, the decisions
 * people set (and the folders `reorg` sorts projects into), stars and thresholds. Tag names must
 * stay the same from run to run (livesaver only replaces tags it recognises as its own), so the
 * names are configuration: `customProfile` applies the ones from the config file.
 */

export type StageKey = 'empty' | 'session' | 'sketch' | 'arranged' | 'elaborated'
export const STAGE_KEYS: readonly StageKey[] = [
  'empty',
  'session',
  'sketch',
  'arranged',
  'elaborated',
]

export type TagKey =
  | 'complete'
  | 'samplesMissing'
  | 'pluginsMissing'
  | 'rosetta'
  | 'export'
  | 'duplicate'

export interface StatusDecision {
  /** Tag name, e.g. "Continue". */
  readonly name: string
  /** Folder `reorg` moves the project into, e.g. "1 In Progress". */
  readonly folder: string
  /** Finder colour the tag gets when set from the rating sheet. */
  readonly colour: number
  /** `reorg` keeps the project's old group below the folder ("4 Archive/Old/2014/…"). */
  readonly keepGroup?: boolean
}

export interface Thresholds {
  /** Shorter arrangements are sketches. */
  readonly sketchSeconds: number
  /** Fewer different 8-bar blocks: a loop that was only stretched out. */
  readonly minBlocks: number
  readonly elaboratedBlocks: number
  readonly elaboratedAutomation: number
  /** Longer arrangements are marked "overlong". */
  readonly overlongSeconds: number
}

export interface StatusProfile {
  readonly stages: Readonly<Record<StageKey, string>>
  readonly tags: Readonly<Record<TagKey, string>>
  /** Colours of livesaver's own tags (others get none). */
  readonly colours: Readonly<Partial<Record<TagKey, number>>>
  /** First word of a comment for an unreadable set. */
  readonly error: string
  readonly decisions: readonly StatusDecision[]
  readonly stars: readonly string[]
  readonly thresholds: Thresholds
  /** Separates the automatic part of a comment from the user's own notes. */
  readonly noteSeparator: string
  /** Separates the fields of a comment. */
  readonly field: string
  /** Names listed in a comment before "+N". */
  readonly maxNames: number
}

const ORANGE = 7

export const THRESHOLDS: Thresholds = {
  sketchSeconds: 90,
  minBlocks: 6,
  elaboratedBlocks: 12,
  elaboratedAutomation: 10,
  overlongSeconds: 15 * 60,
}

export const DEFAULT_PROFILE: StatusProfile = {
  stages: {
    empty: 'Empty',
    session: 'Session only',
    sketch: 'Sketch',
    arranged: 'Arranged',
    elaborated: 'Elaborated',
  },
  tags: {
    complete: 'Complete',
    samplesMissing: 'Samples missing',
    pluginsMissing: 'Plugins missing',
    rosetta: 'Rosetta',
    export: 'Export',
    duplicate: 'Duplicate',
  },
  colours: { samplesMissing: ORANGE, pluginsMissing: ORANGE },
  error: 'Error',
  decisions: [
    { name: 'Continue', folder: '1 In Progress', colour: 2 },
    { name: 'Later', folder: '2 Ideas', colour: 4 },
    { name: 'Done', folder: '3 Done', colour: 3 },
    { name: 'Archive', folder: '4 Archive', colour: 1, keepGroup: true },
    { name: 'Salvage', folder: '5 Salvage', colour: 5, keepGroup: true },
    { name: 'Delete', folder: '6 Delete', colour: 6, keepGroup: true },
  ],
  stars: ['1★', '2★', '3★', '4★', '5★'],
  thresholds: THRESHOLDS,
  noteSeparator: '‖',
  field: ' · ',
  maxNames: 3,
}

/** A profile with some names replaced (from the config file). */
export function customProfile(
  base: StatusProfile,
  overrides: {
    readonly stages?: Partial<Record<StageKey, string>>
    readonly tags?: Partial<Record<TagKey, string>>
    readonly error?: string
    readonly decisions?: readonly StatusDecision[]
    readonly stars?: readonly string[]
    readonly thresholds?: Partial<Thresholds>
  },
): StatusProfile {
  return {
    ...base,
    stages: { ...base.stages, ...overrides.stages },
    tags: { ...base.tags, ...overrides.tags },
    error: overrides.error ?? base.error,
    decisions: overrides.decisions ?? base.decisions,
    stars: overrides.stars ?? base.stars,
    thresholds: { ...base.thresholds, ...overrides.thresholds },
  }
}

/** The tag names livesaver owns (and replaces); all others belong to the user. */
export function managedTags(profile: StatusProfile): Set<string> {
  return new Set([...Object.values(profile.stages), ...Object.values(profile.tags)])
}
