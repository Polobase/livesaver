/**
 * The state of a set, a project or a reference, in the app's three words: fine, can be fixed,
 * missing. A state is never told by colour alone: each has an icon of its own shape and a label.
 */
import type { ProjectRow, SetRow, Status } from '@livesaver/ops'

export type Health = 'fine' | 'fixable' | 'missing' | 'unreadable'

export interface HealthLook {
  readonly label: string
  readonly icon: string
  /** The Tailwind class that colours the icon (the label stays in the text colour). */
  readonly tone: string
  /** The CSS variable of the colour, for a bar's segment. */
  readonly colour: string
}

export const HEALTH: Readonly<Record<Health, HealthLook>> = {
  fine: {
    label: 'Complete',
    icon: 'i-lucide-circle-check',
    tone: 'text-(--status-fine)',
    colour: 'var(--status-fine)',
  },
  fixable: {
    label: 'Can be fixed',
    icon: 'i-lucide-wrench',
    tone: 'text-(--status-fixable)',
    colour: 'var(--status-fixable)',
  },
  missing: {
    label: 'Samples missing',
    icon: 'i-lucide-triangle-alert',
    tone: 'text-(--status-missing)',
    colour: 'var(--status-missing)',
  },
  // Not a state of the samples: what is in the set is not known.
  unreadable: {
    label: 'Unreadable',
    icon: 'i-lucide-file-x',
    tone: 'text-(--status-unknown)',
    colour: 'var(--status-unknown)',
  },
}

/** In the order a bar shows them: what is fine first, what needs attention last. */
export const HEALTHS: readonly Health[] = ['fine', 'fixable', 'missing', 'unreadable']

export const missingOf = (counts: Readonly<Record<Status, number>>): number =>
  counts['not-found'] + counts.ambiguous + counts.mismatch

/**
 * A set is `missing` as soon as one of its samples stays missing, even if a fix repairs others
 * of it: that is the state a fix does not end.
 */
export function setHealth(row: SetRow): Health {
  if (row.error) return 'unreadable'
  if (missingOf(row.counts) > 0) return 'missing'
  return row.changes > 0 ? 'fixable' : 'fine'
}

/** A project whose only trouble is a set that cannot be read is `unreadable`, not `missing`. */
export function projectHealth(row: ProjectRow): Health {
  if (row.missing > 0) return 'missing'
  if (row.errors > 0) return 'unreadable'
  return row.changes > 0 ? 'fixable' : 'fine'
}

export function tally<T>(rows: readonly T[], of: (row: T) => Health): Record<Health, number> {
  const totals: Record<Health, number> = { fine: 0, fixable: 0, missing: 0, unreadable: 0 }
  for (const row of rows) totals[of(row)]++
  return totals
}

/** What a reference is, in the words of the app. */
export const STATUS_LABEL: Readonly<Record<Status, string>> = {
  ok: 'In the project',
  kept: 'In a pack or in Live',
  external: 'Outside the project',
  found: 'Found elsewhere',
  'not-found': 'Not found',
  ambiguous: 'Several candidates',
  mismatch: 'Different content',
}

/** Why a sample stays missing, said to someone who wants to do something about it. */
export const STATUS_WHY: Readonly<Record<'not-found' | 'ambiguous' | 'mismatch', string>> = {
  'not-found': 'No file of this name is in the folders that were searched.',
  ambiguous: 'Several files of this name fit, with different audio: livesaver does not guess.',
  mismatch: 'A file of this name was found, but it is not the same audio.',
}

export const ACTION_LABEL: Readonly<Record<string, string>> = {
  collected: 'Collect',
  repaired: 'Repair',
  'path-updated': 'Update path',
}

/** What an action does, for someone who has not read the manual. */
export const ACTION_WHY: Readonly<Record<string, string>> = {
  collected:
    'The file exists outside the project: it is copied in, and the set points at the copy.',
  repaired: 'The file was missing and found elsewhere: the set points at it again.',
  'path-updated': 'The file is in the project already; only the stored path is brought up to date.',
}
