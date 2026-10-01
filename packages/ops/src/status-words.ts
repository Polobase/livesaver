/** Texts of `status`: comments, reports and sheet columns. */
import type { Availability } from '@livesaver/plugins'

export interface Words {
  unreadable: string
  overlong: string
  sessionClips(clips: number, scenes: number): string
  tracks(n: number): string
  missing: string
  samples(n: number): string
  complete: string
  mainSet(name: string): string
  sets(n: number): string
  alsoIn: string
  allSetsEqual: string
  compared: readonly [same: string, different: string, onlyHere: string, onlyThere: string]
  noName: string
  yes: string
  no: string
  states: Record<Availability, string>
  failedHint(bundle: string): string
  permission: string
  scriptFailed(detail: string): string
  mismatch(detail: string): string
  noFinder: string
  sheetOpen: string
  sheetKept: string
  sheetGone(key: string): string
  sheetNotFound(key: string): string
  unclearDecision(key: string, value: string, options: string): string
  unclearStars(key: string, value: string): string
  notesWithoutComments: string
  decisionTaken(value: string): string
  starsTaken(value: string): string
  noteTaken: string
  empty: string
  setsHeader: readonly string[]
  sheetColumns: readonly string[]
  tagsComment: readonly [string, string]
  pluginsHeader: readonly string[]
  files: { sets: string; projects: string; plugins: string; overview: string }
}

export const WORDS: Words = {
  unreadable: 'unreadable',
  overlong: ' overlong',
  sessionClips: (c, s) => `${c} clip${c !== 1 ? 's' : ''} in ${s} scene${s !== 1 ? 's' : ''}`,
  tracks: (n) => `${n} track${n !== 1 ? 's' : ''}`,
  missing: 'missing',
  samples: (n) => `${n} sample${n !== 1 ? 's' : ''}`,
  complete: 'complete',
  mainSet: (name) => `main set “${name}”`,
  sets: (n) => `${n} set${n !== 1 ? 's' : ''}`,
  alsoIn: 'also in',
  allSetsEqual: 'all sets equal',
  compared: ['same', 'different', 'only here', 'only there'],
  noName: '(no name)',
  yes: 'yes',
  no: 'no',
  states: { installed: 'installed', rosetta: 'Rosetta', missing: 'missing' },
  failedHint: (b) => `bundle present, but Live could not load it: ${b}`,
  permission:
    'no permission to control Finder (System Settings → Privacy & Security → Automation: allow Terminal → Finder)',
  scriptFailed: (d) => d,
  mismatch: (d) => `Finder returned ${d.replace('/', ' instead of ')} comments`,
  noFinder: 'Finder comments are not available here',
  sheetOpen: 'the sheet is open – save, close it and run again',
  sheetKept: 'not everything was taken over (see above); your entries stay in the sheet',
  sheetGone: (k) => `${k}: project no longer exists, row dropped`,
  sheetNotFound: (k) => `${k}: project not found (group/project changed?)`,
  unclearDecision: (k, v, o) => `${k}: decision “${v}” unclear (${o})`,
  unclearStars: (k, v) => `${k}: stars “${v}” unclear (1 to 5)`,
  notesWithoutComments: 'notes not taken over: --no-comments',
  decisionTaken: (v) => `decision ${v || '(empty)'}`,
  starsTaken: (v) => `stars ${v || '(empty)'}`,
  noteTaken: 'note',
  empty: '(empty)',
  setsHeader: [
    'Project',
    'Set',
    'Live version',
    'Progress',
    'Length',
    'Bars',
    'Start (bar)',
    'BPM',
    'Time signature',
    'Audio tracks',
    'MIDI tracks',
    'Groups',
    'Returns',
    'Named tracks',
    'Arrangement clips',
    'Tracks in arrangement',
    'Distinct 8-bar blocks',
    '8-bar blocks',
    'Session clips',
    'Scenes used',
    'Scenes',
    'Locators',
    'Automated parameters',
    'Master chain',
    'Missing samples',
    'Sources of missing samples',
    'Missing Max devices',
    'Missing plugins',
    'Rosetta only',
    'All plugins',
    'Export',
    'Tags',
    'Comment',
    'Error',
  ],
  sheetColumns: [
    'Group',
    'Project',
    'Decision',
    'Stars',
    'Note',
    'Progress',
    'Main set',
    'Length',
    'BPM',
    'Sets',
    'Complete',
    'Missing samples',
    'Missing plugins',
    'Rosetta only',
    'Duplicate',
    'Export',
    'Size (MB)',
    'Live version',
  ],
  tagsComment: ['Tags', 'Comment'],
  pluginsHeader: [
    'Plugin',
    'Format',
    'ID',
    'Status',
    'Installed at',
    'Not yet scanned by Live',
    'Note',
    'Sets',
    'Projects',
    'Project list',
  ],
  files: {
    sets: 'sets.csv',
    projects: 'projects.csv',
    plugins: 'plugins.csv',
    overview: 'overview.md',
  },
}

/** Report file names of a status run. */
export const STATUS_FILES: Words['files'] = WORDS.files
