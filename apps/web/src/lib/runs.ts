/** A run of the history in the app's words: what it was, what it did, what became of it. */
import type { RunState } from '@livesaver/ops'
import type { EngineKind, Run } from '../engine/types.js'
import { bytes, count, dayName, plural } from './format.js'

/**
 * Where an undo puts the copies it takes out of a project: the Trash, or, in a browser (a page
 * has no Trash), a hidden folder of the project folder.
 */
export const TAKEN_OUT: Readonly<Record<EngineKind, string>> = {
  computer: 'moved to the Trash',
  browser: 'moved to the hidden folder “.livesaver-trash” of the project folder',
}

export interface RunLook {
  /** What the run was, as a headline. */
  readonly title: string
  readonly icon: string
}

const names = (paths: readonly string[]) =>
  paths.map((path) => path.split('/').filter(Boolean).pop() ?? path)

/** What a run did, said as the result it left (or would have left, for a dry run). */
export function runLook(run: Run): RunLook {
  const dry = !run.applied
  const command = run.command
  if (command === 'collect')
    return dry
      ? { title: 'Planned a fix (nothing was written)', icon: 'i-lucide-clipboard-list' }
      : {
          title:
            run.sets + run.files === 0
              ? 'A fix with nothing to do'
              : `Fixed ${plural(run.sets, 'set')}, copied ${plural(run.files, 'file')}`,
          icon: 'i-lucide-wrench',
        }
  if (command === 'vst3')
    return dry
      ? {
          title: 'Planned a plug-in upgrade (nothing was written)',
          icon: 'i-lucide-clipboard-list',
        }
      : {
          title: `Upgraded plug-ins to VST3 in ${plural(run.sets, 'set')}`,
          icon: 'i-lucide-circle-arrow-up',
        }
  if (command === 'plugin-audit') return { title: 'Plug-in audit', icon: 'i-lucide-plug' }
  if (command === 'status')
    return {
      title: dry
        ? 'Planned Finder tags and comments (nothing was written)'
        : `Set ${plural(run.tags, 'Finder tag')} and ${plural(run.comments, 'comment')}`,
      icon: 'i-lucide-tags',
    }
  if (command === 'reorg-plan' || command === 'move-plan')
    return { title: 'Wrote a plan to check', icon: 'i-lucide-clipboard-list' }
  if (command === 'reorg')
    return {
      title: dry
        ? 'Checked a plan to sort project folders'
        : `Moved ${plural(run.renames, 'project folder')}`,
      icon: 'i-lucide-folder-tree',
    }
  if (command === 'move')
    return {
      title: dry ? 'Checked a plan to move sets' : 'Moved sets into projects of their own',
      icon: 'i-lucide-folder-input',
    }
  if (command.startsWith('run-'))
    return {
      title: `Codemod ${command.slice(4)}${dry ? ' (nothing was written)' : `: ${plural(run.sets, 'set')} changed`}`,
      icon: 'i-lucide-code',
    }
  return { title: command, icon: 'i-lucide-circle' }
}

/** What became of a run since, where that is worth a word. */
export const STATE_NOTE: Readonly<Record<RunState, string>> = {
  'dry-run': '',
  nothing: '',
  applied: '',
  undone: 'Undone',
  'partly-undone': 'Undone in part',
}

/** Where a run worked, and with which options that are not the usual ones. */
export function runFacts(run: Run): string[] {
  const record = run.record
  if (!record) return []
  const options = record.options
  const targets = names(record.targets)
  return [
    targets.length
      ? `In ${targets.slice(0, 3).join(', ')}${targets.length > 3 ? ` and ${targets.length - 3} more` : ''}`
      : '',
    options.certainOnly === true ? 'uncertain matches left out' : '',
    options.matchLibraryPath === true ? 'library files accepted by their place' : '',
    Array.isArray(options.plugin) && options.plugin.length
      ? `only ${options.plugin.join(', ')}`
      : '',
    record.error ? `stopped: ${record.error}` : '',
    record.ended === undefined && run.applied ? 'did not finish' : '',
  ].filter((fact) => fact)
}

/** The command line that does what a run did (the app's buttons run the same commands). */
const COMMAND: Readonly<Record<string, string>> = {
  collect: 'collect',
  vst3: 'plugins upgrade',
  'plugin-audit': 'plugins audit',
  status: 'status',
  'reorg-plan': 'reorg plan',
  reorg: 'reorg run',
  'move-plan': 'move plan',
  move: 'move run',
}

export function commandOf(run: Run): string {
  const name = run.command.startsWith('run-')
    ? `run ${run.command.slice(4)}`
    : (COMMAND[run.command] ?? run.command)
  return `livesaver ${name}${run.applied ? ' --apply' : ''}`
}

export interface RunFact {
  readonly label: string
  /** One line each. */
  readonly values: readonly string[]
}

const OPTION: Readonly<Record<string, string>> = {
  search: 'Sample folders',
  vendorLibraries: 'Installed libraries',
  ignore: 'Not searched',
  exclude: 'Left out',
  packLimit: 'Pack files',
  matchLibraryPath: 'Library files',
  certainOnly: 'Uncertain matches',
  plugin: 'Only these plug-ins',
  comments: 'Finder comments',
  sheet: 'Rating sheet',
  exports: 'Exports',
  into: 'Into',
}

/** What an option says when it is set, where a plain yes would not tell. */
const SET: Readonly<Record<string, string>> = {
  matchLibraryPath: 'accepted by their place in the library',
  certainOnly: 'left out',
  comments: 'set',
}

/** The options that shaped a run, in words; what was not set is left out. */
export function optionFacts(run: Run): RunFact[] {
  const facts: RunFact[] = []
  for (const [name, value] of Object.entries(run.record?.options ?? {})) {
    const values =
      name === 'packLimit' && typeof value === 'number'
        ? [value === 0 ? 'never copied' : `copied up to ${count(value)} MB`]
        : Array.isArray(value)
          ? value.map(String)
          : value === true
            ? [SET[name] ?? 'yes']
            : typeof value === 'number'
              ? [count(value)]
              : typeof value === 'string' && value
                ? [value]
                : []
    if (values.length) facts.push({ label: OPTION[name] ?? name, values })
  }
  return facts
}

const OUTCOME: Readonly<Record<string, string>> = {
  sets: 'Sets looked at',
  changingSets: 'Sets with something to change',
  written: 'Sets rewritten',
  changed: 'Sets changed',
  files: 'Files copied',
  bytes: 'Size of the copies',
  errors: 'Sets with an error',
  plugins: 'Plug-ins in use',
  missing: 'Plug-ins missing',
  projects: 'Projects',
  moves: 'Moves',
  problems: 'With problems',
}

/** The numbers a run ended with. */
export function outcomeFacts(run: Run): RunFact[] {
  return Object.entries(run.record?.outcome ?? {}).map(([name, value]) => ({
    label: OUTCOME[name] ?? name,
    values: [name === 'bytes' ? bytes(value) : count(value)],
  }))
}

/** What an undo of a run does, line by line, to read before it is done. */
export function undoLines(run: Run, where: EngineKind = 'computer'): string[] {
  return [
    run.sets
      ? `${plural(run.sets, 'set goes', 'sets go')} back to what ${run.sets === 1 ? 'it was' : 'they were'} before the run, from the originals livesaver kept.`
      : '',
    run.files
      ? `${plural(run.files, 'copied file is', 'copied files are')} ${TAKEN_OUT[where]}, unless another set uses ${run.files === 1 ? 'it' : 'them'} by now.`
      : '',
    run.renames
      ? `${plural(run.renames, 'file or folder that was moved goes', 'files or folders that were moved go')} back to where ${run.renames === 1 ? 'it was' : 'they were'}.`
      : '',
    run.tags + run.comments ? 'Finder tags and comments are set back to what they were.' : '',
    run.ownFiles
      ? `${plural(run.ownFiles, 'file of livesaver’s own is', 'files of livesaver’s own are')} put back.`
      : '',
    'What was changed since the run is left alone, and reported.',
  ].filter((line) => line)
}

/** Runs that changed something, or tried to: what a history is mostly looked at for. */
export const changedSomething = (run: Run): boolean => run.applied && run.state !== 'nothing'

export const STEP_LABEL: Readonly<Record<string, string>> = {
  'write-set': 'Set rewritten',
  copy: 'File copied',
  rename: 'Moved',
  tags: 'Finder tags set',
  comments: 'Finder comments set',
  'replace-file': 'File of livesaver replaced',
}

const UNDONE: Readonly<Record<string, string>> = {
  restored: 'restored',
  'renamed-back': 'moved back',
  'changed-since': 'changed since, left alone',
}

/** What became of a step that was taken back, in words. */
export const undoneLabel = (result: string, where: EngineKind = 'computer'): string =>
  result === 'trashed' ? TAKEN_OUT[where] : (UNDONE[result] ?? result)

/** When a run started: as it wrote it down, else as its folder is named (local time). */
export function startedAt(run: Run): Date | undefined {
  const text = run.record?.started ?? run.when.replace(' ', 'T')
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? undefined : date
}

export interface RunDay {
  /** `Today`, `Yesterday`, or the date. */
  readonly label: string
  readonly runs: readonly Run[]
}

/** The runs by the day they ran on, in the order given (the newest first). */
export function byDay(runs: readonly Run[], now = new Date()): RunDay[] {
  const days: { label: string; runs: Run[] }[] = []
  const name = (date: Date | undefined) => {
    if (!date) return 'Some time ago'
    const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const ago = Math.round((midnight(now) - midnight(date)) / 86_400_000)
    return ago === 0 ? 'Today' : ago === 1 ? 'Yesterday' : dayName(date)
  }
  for (const run of runs) {
    const label = name(startedAt(run))
    const last = days.at(-1)
    if (last?.label === label) last.runs.push(run)
    else days.push({ label, runs: [run] })
  }
  return days
}
