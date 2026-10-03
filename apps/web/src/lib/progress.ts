/** How far a run is, as the screens show it. */
import type { Phase, Progress } from '../engine/types.js'

export interface RunProgress {
  readonly phase: Phase
  /** Audio files and Max devices listed in the folders that are searched. */
  readonly files: number
  readonly done: number
  readonly total: number
  /** The set that was read last. */
  readonly name: string
}

export const starting = (phase: Phase): RunProgress => ({
  phase,
  files: 0,
  done: 0,
  total: 0,
  name: '',
})

export function advance(run: RunProgress, event: Progress): RunProgress {
  if (event.type === 'phase') return { ...run, phase: event.phase, done: 0, total: 0, name: '' }
  if (event.type === 'indexed') return { ...run, files: event.files }
  if (event.type === 'progress')
    return { ...run, done: event.done, total: event.total, name: event.name }
  return run
}

/** What happens in a phase, said while it happens. */
export const PHASE_LABEL: Readonly<Record<Phase, string>> = {
  locating: 'Finding out where your folders lie',
  indexing: 'Listing audio files and Max devices',
  checking: 'Reading your sets',
  plugins: 'Looking up installed plug-ins',
  fixing: 'Fixing sets',
  upgrading: 'Upgrading plug-ins',
  reporting: 'Putting the result together',
}

/** The phases of a scan in their order, for a list that ticks them off. */
export const SCAN_PHASES: readonly Phase[] = ['indexing', 'checking', 'plugins', 'reporting']
