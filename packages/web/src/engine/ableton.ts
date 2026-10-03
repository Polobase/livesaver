/**
 * Ableton's own folders among the folders a page was given, recognised by name: the User Library
 * and the Factory Packs (both in `Music/Ableton`), and Live's own content, which lies inside the
 * Live app: `Contents/App-Resources` holds the Core Library and the table of content Live moved
 * between versions.
 */
import type { FolderSource } from '../source.js'

/**
 * Where `App-Resources` may lie in a given folder: the folder is it, or is the `Contents` folder
 * of the Live app, or is the Live app itself. An app is a folder to a drop, while a folder dialog
 * does not open it.
 */
export const APP_RESOURCES_IN = ['', 'App-Resources', 'Contents/App-Resources'] as const

export interface Holds {
  readonly userLibrary: boolean
  readonly factoryPacks: boolean
  /** Live's own content: the Core Library. */
  readonly live: boolean
}

const PREFIXES: readonly (readonly [keyof Holds, string])[] = [
  ['userLibrary', 'user library/'],
  ['factoryPacks', 'factory packs/'],
  ...APP_RESOURCES_IN.map(
    (dir) => ['live', `${dir ? `${dir}/` : ''}core library/`.toLowerCase()] as const,
  ),
]
const LONGEST = Math.max(...PREFIXES.map(([, prefix]) => prefix.length))

const known = new WeakMap<FolderSource, Holds>()

/**
 * What a folder holds, from its name and the paths of its files, as soon as it was given.
 * `undefined` for a handle: what it holds is only known once it is read.
 */
export function holdsOf(source: FolderSource): Holds | undefined {
  if (source.kind === 'handle') return undefined
  let holds = known.get(source)
  if (!holds) {
    const name = source.name.toLowerCase()
    const found = {
      userLibrary: name === 'user library',
      factoryPacks: name === 'factory packs',
      live: name === 'core library',
    }
    const count = source.kind === 'files' ? source.files.length : source.paths.length
    for (let i = 0; i < count; i++) {
      const path = source.kind === 'files' ? source.files[i]?.path : source.paths[i]
      const head = (path ?? '').slice(0, LONGEST).toLowerCase()
      for (const [what, prefix] of PREFIXES) if (head.startsWith(prefix)) found[what] = true
    }
    holds = found
    known.set(source, holds)
  }
  return holds
}

/** The names of what a folder holds, for the page. */
export function holdsNames(holds: Holds | undefined): string[] {
  return [
    holds?.userLibrary ? 'User Library' : '',
    holds?.factoryPacks ? 'Factory Packs' : '',
    holds?.live ? "Live's own content" : '',
  ].filter((name) => name)
}
