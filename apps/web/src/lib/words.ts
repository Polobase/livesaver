/**
 * What to do about missing samples, by where they came from. The command line gives the same
 * advice in its own terms (`--search`); here it is said in the app's.
 */
import type { SourceRow } from '@livesaver/ops'
import { plural } from './format.js'

export interface Advice {
  readonly text: string
  /** Whether adding a sample folder is what helps: the app then offers to do that. */
  readonly addFolder: boolean
  /**
   * The samples lie in an installed library with another fingerprint: the rule for library
   * files takes them, and the app offers to switch it on.
   */
  readonly accept: boolean
}

const ADVICE: Readonly<Record<string, Omit<Advice, 'accept'>>> = {
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
  // What a browser kept the page from: no place the samples came from (see `Blind`).
  unseen: {
    text: 'They may well be where your sets expect them. In a project folder that was chosen for editing, a browser shows a page no file or folder with a “/” in its name (as Finder shows it) or with a space at its start or end. Drop your project folder onto the sample folders as well: a dropped folder shows every name.',
    addFolder: true,
  },
  unmade: {
    text: 'They were found, and would be copied into their projects. A browser makes no file with a “/” in its name (as Finder shows it) or with a space at its start or end. livesaver on your computer copies them in.',
    addFolder: false,
  },
  locked: {
    text: 'They were found, but this page cannot rewrite their sets: the set, or a folder it lies in, has a name the browser hides. livesaver on your computer fixes them.',
    addFolder: false,
  },
}

/**
 * `inLibrary` of `samples`: so many of the source's samples are in the library as it is installed
 * now. Such a source is not something to get: it is there, in another version.
 */
export function adviceFor(
  source: Pick<SourceRow, 'advice' | 'hint'> & Partial<Pick<SourceRow, 'inLibrary' | 'samples'>>,
): Advice {
  const usual = ADVICE[source.advice] ?? { text: source.hint, addFolder: false }
  const inLibrary = source.inLibrary ?? 0
  if (inLibrary === 0) return { ...usual, accept: false }
  if (source.samples === undefined || inLibrary >= source.samples)
    return {
      text: 'It is installed, in another version than your sets remember: its vendor re-saved these files, so their fingerprints differ.',
      addFolder: false,
      accept: true,
    }
  return {
    text: `${plural(inLibrary, 'of these is', 'of these are')} in the library as it is installed now, re-saved by its vendor. The rest: ${usual.text}`,
    addFolder: usual.addFolder,
    accept: true,
  }
}
