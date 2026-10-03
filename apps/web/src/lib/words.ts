/**
 * What to do about missing samples, by where they came from. The command line gives the same
 * advice in its own terms (`--search`); here it is said in the app's.
 */
import type { SourceRow } from '@livesaver/ops'

export interface Advice {
  readonly text: string
  /** Whether adding a sample folder is what helps: the app then offers to do that. */
  readonly addFolder: boolean
}

const ADVICE: Readonly<Record<string, Advice>> = {
  pack: {
    text: 'Install the pack in Live (under Packs), or download it from your account at ableton.com.',
    addFolder: false,
  },
  'core-library': {
    text: "These came with an older version of Live. Add that version's Core Library as a sample folder if you still have it.",
    addFolder: true,
  },
  'ni-expansion': {
    text: 'Install it in Native Access if it is in your Native Instruments account, then scan again.',
    addFolder: false,
  },
  'user-library': {
    text: 'They were in an older User Library. Add it as a sample folder if you still have it, for example on your previous computer or a backup.',
    addFolder: true,
  },
  'old-project': {
    text: 'They belong to another project. Add an old copy of that project folder (an old drive, a backup) as a sample folder.',
    addFolder: true,
  },
  'project-samples': {
    text: "The project's own samples are gone. Add an older copy of the project folder as a sample folder.",
    addFolder: true,
  },
  folder: {
    text: 'Find this folder or drive and add it as a sample folder.',
    addFolder: true,
  },
}

export function adviceFor(source: Pick<SourceRow, 'advice' | 'hint'>): Advice {
  return ADVICE[source.advice] ?? { text: source.hint, addFolder: false }
}
