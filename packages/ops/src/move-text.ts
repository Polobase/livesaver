/** Texts of `move`: problems, plan and report columns. */
import { PROJECT_MARKER } from './collect.js'

export const MOVE_TEXT = {
  from: 'from',
  unreadable: (e: string) => `set unreadable: ${e}`,
  differentProjects: (roots: string) => `sets from different projects: ${roots}`,
  onlyTop: 'only sets directly in the project folder can move',
  nested: 'target and old project lie inside each other',
  notProject: `target is no Live project (no folder “${PROJECT_MARKER}”)`,
  nameTaken: (n: string) => `${n}: name already taken in the target`,
  backupTaken: (n: string) => `backup ${n}: name already taken in the target`,
  otherFile: (r: string) => `${r}: the target has another file of this name`,
  wouldFind: (set: string, name: string, found: string) =>
    `${set}: ${name} would then find ${found || 'no file any more'}`,
  exists: (p: string) => `${p} exists already`,
  aborted: (e: string) => `stopped while moving: ${e}`,
  note: (shared: number, own: number, name: string) =>
    `${shared} of ${own} files shared with “${name}”`,
  targetExists: ', target project exists already',
  planColumns: ['Set', 'Target project', 'Note'],
  reportColumns: [
    'Old project',
    'Target project',
    'Target',
    'Set',
    'New name',
    'Backups',
    'Copied files',
    'Copied (MB)',
    'Already in target',
    'Unused in old project afterwards',
    'Status',
  ],
  newTarget: 'new',
  existingTarget: 'existing',
  moved: 'moved',
  planned: 'planned',
  error: 'Error',
  report: 'move.csv',
  plan: 'move_plan.csv',
} as const

/** Report and plan file names of `move`. */
export const MOVE_FILES = { report: MOVE_TEXT.report, plan: MOVE_TEXT.plan } as const
