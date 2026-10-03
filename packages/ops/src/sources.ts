/**
 * Where missing samples came from, and where found ones lie, grouped by pack / library / project /
 * folder.
 */
import { CORE_LIBRARY_PACK_ID, type FileRef, norm, posix, REL_USER_LIBRARY } from '@livesaver/core'
import type { SetResult } from './collect.js'
import { type Environment, isInside } from './env.js'
import type { Choice, Status } from './match.js'

/** Where a missing sample originally came from. */
export function sourceOf(ref: FileRef): string {
  const path = ref.path || ref.hintPath || ref.relPath
  const low = path.toLowerCase()
  if (
    ref.packId === CORE_LIBRARY_PACK_ID ||
    ref.packName === 'Core Library' ||
    low.includes('core library')
  ) {
    return 'Ableton Core Library (older Live version)'
  }
  if (ref.packName) return `Live Pack: ${ref.packName}`
  if (low.includes('maschine library')) return 'NI Maschine Library'
  if (ref.relType === REL_USER_LIBRARY || low.includes('user library')) return 'User Library (old)'
  let m = /^([A-Za-z]):/.exec(path)
  if (m) return `Windows drive ${(m[1] as string).toUpperCase()}:`
  m = /^\/Volumes\/([^/]+)/.exec(path)
  if (m) return `Drive ${m[1]}`
  m = /^\/Users\/([^/]+)\//.exec(path)
  if (m) return `Mac user ${m[1]}`
  if (path.startsWith('/Applications/')) return 'Ableton app (older version)'
  if (path) return 'other location'
  return 'unknown'
}

export type LibraryKind =
  | 'pack'
  | 'core-library'
  | 'folder'
  | 'project-samples'
  | 'ni-expansion'
  | 'user-library'
  | 'old-project'

/** Names of the kinds (they also define the sort order). */
export const KIND_NAMES: Record<LibraryKind, string> = {
  pack: 'Ableton pack',
  'core-library': 'Ableton Core Library',
  folder: 'Folder',
  'project-samples': "Project's own samples",
  'ni-expansion': 'NI expansion',
  'user-library': 'User Library (old)',
  'old-project': 'Old project',
}

/** What to do about missing samples of each kind. */
export const HINTS: Record<LibraryKind, string> = {
  pack: "Install the pack in Live (Packs) or from ableton.com under the pack's name",
  'core-library': 'Extract the Core Library from the old Live installer',
  'ni-expansion': 'Install it in Native Access if it is in your NI account',
  'user-library': 'Look for the old User Library on your previous computer',
  'old-project': 'Look for an old copy of the project folder (old drive, backup)',
  'project-samples':
    "The project's own samples are missing: look for an older copy of the project folder",
  folder: 'Find the folder or drive and pass it with --search',
}

export interface MissingGroup {
  readonly status: Status
  readonly name: string
  readonly path: string
  readonly kind: FileRef['kind']
  /** Where it came from (`sourceOf`). */
  readonly source: string
  readonly pack: string
  readonly size: number
  readonly sets: Set<string>
  readonly projects: Set<string>
  readonly choice: Choice
}

/** One entry per distinct missing sample. */
export function missingGroups(results: readonly SetResult[]): MissingGroup[] {
  const groups = new Map<string, MissingGroup>()
  for (const res of results) {
    for (const { ref, choice } of res.missing) {
      const original = ref.path || ref.hintPath || ref.relPath || ref.name
      const key = `${choice.status}\u0000${norm(original)}`
      let group = groups.get(key)
      if (!group) {
        group = {
          status: choice.status,
          name: ref.name,
          path: original,
          kind: ref.kind,
          source: sourceOf(ref),
          pack: ref.packName,
          size: ref.size,
          sets: new Set(),
          projects: new Set(),
          choice,
        }
        groups.set(key, group)
      }
      group.sets.add(res.setPath)
      group.projects.add(res.projectRoot)
    }
  }
  const byKey = (g: MissingGroup) => [g.source, norm(g.path)] as const
  return [...groups.values()].sort((a, b) => {
    const [as, ap] = byKey(a)
    const [bs, bp] = byKey(b)
    return as < bs ? -1 : as > bs ? 1 : ap < bp ? -1 : ap > bp ? 1 : 0
  })
}

/** (kind, name) of the pack, expansion, project or folder a missing sample came from. */
export function libraryOf(
  group: Pick<MissingGroup, 'source' | 'path' | 'pack'>,
): [LibraryKind, string] {
  const { source, path } = group
  if (source.startsWith('Live Pack: ')) return ['pack', group.pack]
  if (source.startsWith('Ableton Core Library'))
    return ['core-library', 'Core Library of older Live versions']
  const parts = posix.splitPath(path)
  const folders = parts.slice(0, -1)
  const low = folders.map((p) => p.toLowerCase())
  if (folders.length === 0) return ['folder', '(file name only)']
  // Every alternative is anchored at the start.
  if (!/^(?:[A-Za-z]:|[\\/])/.test(path)) return ['project-samples', folders.slice(0, 2).join('/')]
  if (low.includes('maschine library')) {
    const rest = folders.slice(low.indexOf('maschine library') + 1)
    const first = rest[0]
    const name = first?.toLowerCase().endsWith(' library') ? first : 'Maschine Library'
    return ['ni-expansion', name.replace('Gray Forge', 'Grey Forge')]
  }
  if (low.includes('user library')) {
    const last = low.lastIndexOf('user library')
    return ['user-library', folders.slice(last + 1, last + 3).join('/') || 'User Library']
  }
  const project = folders.find((f) => f.toLowerCase().endsWith(' project'))
  if (project) return ['old-project', project]
  const windows = /^(?:[A-Za-z]:|\\)/.test(path)
  const sep = windows ? '\\' : '/'
  const prefix = windows || !path.startsWith('/') ? '' : '/'
  return ['folder', prefix + folders.slice(0, 4).join(sep)]
}

export interface Library {
  readonly kind: LibraryKind
  readonly name: string
  samples: number
  notFound: number
  readonly sets: Set<string>
  readonly projects: Set<string>
  readonly folders: Map<string, number>
  readonly examples: string[]
}

/** Missing samples aggregated per source, largest first. */
export function libraryGroups(groups: readonly MissingGroup[]): Library[] {
  const libraries = new Map<string, Library>()
  for (const g of groups) {
    const [kind, name] = libraryOf(g)
    const key = `${kind}\u0000${name}`
    let lib = libraries.get(key)
    if (!lib) {
      lib = {
        kind,
        name,
        samples: 0,
        notFound: 0,
        sets: new Set(),
        projects: new Set(),
        folders: new Map(),
        examples: [],
      }
      libraries.set(key, lib)
    }
    lib.samples++
    if (g.status === 'not-found') lib.notFound++
    for (const s of g.sets) lib.sets.add(s)
    for (const p of g.projects) lib.projects.add(p)
    const folder = posix.dirname(g.path.replaceAll('\\', '/'))
    lib.folders.set(folder, (lib.folders.get(folder) ?? 0) + 1)
    if (lib.examples.length < 5) lib.examples.push(g.name)
  }
  const kindName = (l: Library) => KIND_NAMES[l.kind]
  return [...libraries.values()].sort(
    (a, b) =>
      b.samples - a.samples ||
      (kindName(a) < kindName(b) ? -1 : kindName(a) > kindName(b) ? 1 : 0) ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  )
}

// ------------------------------------------------------------------------------------ found samples

export type FoundKind =
  | 'project'
  | 'core-library'
  | 'pack'
  | 'user-library'
  | 'library'
  | 'other-project'
  | 'folder'

export const FOUND_NAMES: Record<FoundKind, string> = {
  project: 'Own project',
  'core-library': 'Ableton Core Library',
  pack: 'Ableton pack',
  'user-library': 'User Library',
  library: 'Library',
  'other-project': 'Other project',
  folder: 'Folder',
}

/** The first `levels` folders of `path` below `root` ("Samples/Imported"), as spelled on disk. */
function below(path: string, root: string, levels: number): string {
  const skip = posix.splitPath(root).length
  return posix
    .splitPath(posix.dirname(path))
    .slice(skip, skip + levels)
    .join('/')
}

/** (kind, name) of the place a found file lies in; `roots` are the search roots. */
export function foundLocation(
  path: string,
  projectRoot: string,
  env: Environment,
  roots: readonly string[],
): [FoundKind, string] {
  if (isInside(path, projectRoot)) return ['project', below(path, projectRoot, 2) || '.']
  if (env.coreLibrary && isInside(path, env.coreLibrary)) return ['core-library', 'Core Library']
  if (env.factoryPacks && isInside(path, env.factoryPacks))
    return ['pack', below(path, env.factoryPacks, 1)]
  if (env.userLibrary && isInside(path, env.userLibrary))
    return ['user-library', below(path, env.userLibrary, 2) || '.']
  for (const root of env.config.vendorLibraries)
    if (isInside(path, root)) return ['library', below(path, root, 1) || posix.basename(root)]
  const project = posix
    .splitPath(posix.dirname(path))
    .find((folder) => folder.toLowerCase().endsWith(' project'))
  if (project) return ['other-project', project]
  for (const root of [...env.config.preferredRoots, ...roots])
    if (isInside(path, root))
      return ['folder', posix.join(posix.basename(root), below(path, root, 1))]
  return ['folder', posix.dirname(path)]
}

export interface FoundSource {
  readonly kind: FoundKind
  readonly name: string
  /** Distinct files found there. */
  readonly files: Set<string>
  readonly projects: Set<string>
}

/** Where the missing samples that can be repaired were found, largest first. */
export function foundSources(
  results: readonly SetResult[],
  env: Environment,
  roots: readonly string[],
): FoundSource[] {
  const sources = new Map<string, FoundSource>()
  for (const r of results) {
    for (const change of r.changes) {
      if (change.action !== 'repaired') continue
      // Without a copy the file stays where it was found: in the project, or in its pack.
      const path = change.source || posix.join(r.projectRoot, change.newPath)
      const [kind, name] = foundLocation(path, r.projectRoot, env, roots)
      const key = `${kind}\u0000${name}`
      let source = sources.get(key)
      if (!source) {
        source = { kind, name, files: new Set(), projects: new Set() }
        sources.set(key, source)
      }
      source.files.add(norm(path))
      source.projects.add(r.projectRoot)
    }
  }
  const kindName = (f: FoundSource) => FOUND_NAMES[f.kind]
  return [...sources.values()].sort(
    (a, b) =>
      b.files.size - a.files.size ||
      (kindName(a) < kindName(b) ? -1 : kindName(a) > kindName(b) ? 1 : 0) ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  )
}
