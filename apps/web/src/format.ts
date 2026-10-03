/** Words and number formats of the page. */
import type { Status } from '@livesaver/ops'

const integer = new Intl.NumberFormat('en-US')

export const count = (n: number): string => integer.format(n)

export const plural = (n: number, word: string): string =>
  `${count(n)} ${word}${n === 1 ? '' : 's'}`

export function bytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`
  return `${n} bytes`
}

export function percent(part: number, whole: number): string {
  if (whole === 0 || part === 0) return '0%'
  const p = (part / whole) * 100
  return p < 0.1 ? '<0.1%' : `${p < 10 ? p.toFixed(1) : Math.round(p)}%`
}

export const STATUSES: readonly Status[] = [
  'ok',
  'kept',
  'external',
  'found',
  'not-found',
  'ambiguous',
  'mismatch',
]

export const STATUS_LABEL: Record<Status, string> = {
  ok: 'In the project',
  kept: 'In a pack or in Live',
  external: 'Outside the project, can be collected',
  found: 'Missing, can be repaired',
  'not-found': 'Not found',
  ambiguous: 'Ambiguous',
  mismatch: 'Different content',
}

/** Whether a reference is fine, can be fixed by collecting, or stays missing. */
export type Health = 'fine' | 'fixable' | 'missing'

export const HEALTH: Record<Status, Health> = {
  ok: 'fine',
  kept: 'fine',
  external: 'fixable',
  found: 'fixable',
  'not-found': 'missing',
  ambiguous: 'missing',
  mismatch: 'missing',
}

export const HEALTH_LABEL: Record<Health, string> = {
  fine: 'Fine',
  fixable: 'Can be fixed',
  missing: 'Missing',
}

export const ACTION_LABEL: Record<string, string> = {
  collected: 'Collect',
  repaired: 'Repair',
  'path-updated': 'Update path',
}
