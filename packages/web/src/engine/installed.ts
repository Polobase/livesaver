/**
 * What is installed, as far as a page can be told: from folders its user hands it. A plug-in
 * folder (`Plug-Ins`, with `VST3`, `VST` and `Components` in it) shows the bundles. The folder
 * of Live's plug-in database (`Live Database`) says which plug-ins Live scanned, by their ids
 * and per processor: without it a VST2 plug-in cannot be recognised, since its id is nowhere in
 * its bundle.
 *
 * A browser does not say where a folder lies, and the database names bundles by their paths: a
 * plug-in folder is placed where the database's paths lead into it.
 */
import type { PluginRef } from '@livesaver/core'
import { posix } from '@livesaver/core'
import {
  addCatalogRows,
  type Catalog,
  type DbModule,
  type DbPlugin,
  type InstalledPlugin,
  Inventory,
  loadInventory,
  parsePluginDatabase,
} from '@livesaver/plugins'
import { type Mount, WebFs } from '../fs.js'
import type { FolderSource } from '../source.js'
import type { FolderInput } from './protocol.js'

/** Where a plug-in folder may lie in a given folder: it is one, or holds one as `Library` does. */
const PLUGINS_IN = ['', 'Plug-Ins', 'Audio/Plug-Ins'] as const
/** The folders of a plug-in folder, by format. */
const FORMATS = ['VST3', 'VST', 'Components'] as const
/** Where Live's databases may lie in a given folder. */
const DATABASE_IN = [
  '',
  'Live Database',
  'Ableton/Live Database',
  'Application Support/Ableton/Live Database',
] as const
const DATABASE_FILE = /^Live-plugins-.*\.db$/
/** A folder in a folder ('' = the folder itself). */
const inside = (folder: string, dir: string) => (dir ? posix.join(folder, dir) : folder)

export interface InstalledFolders {
  /** The plug-in folders that were found, at the paths they were placed at. */
  readonly roots: readonly string[]
  /** Live's plug-in database was among the folders. */
  readonly database: boolean
}

export interface Installed extends InstalledFolders {
  readonly inventory: Inventory
  /** The VST3 plug-ins Live knows: what an upgrade can convert to. */
  readonly catalog: Catalog
}

const known = new WeakMap<FolderSource, { plugins: boolean; database: boolean }>()

/**
 * What a folder holds of this, from the paths of its files, as soon as it was given (nothing
 * is known of a handle until it is read).
 */
export function installedHoldsOf(source: FolderSource): string[] {
  if (source.kind === 'handle') return []
  let holds = known.get(source)
  if (!holds) {
    const plugins = PLUGINS_IN.flatMap((dir) =>
      FORMATS.map((format) => `${dir ? `${dir}/` : ''}${format}/`.toLowerCase()),
    )
    const databases = DATABASE_IN.map((dir) => `${dir ? `${dir}/` : ''}live-plugins-`.toLowerCase())
    const found = { plugins: false, database: false }
    const count = source.kind === 'files' ? source.files.length : source.paths.length
    for (let i = 0; i < count && !(found.plugins && found.database); i++) {
      const path = (source.kind === 'files' ? source.files[i]?.path : source.paths[i]) ?? ''
      const lower = path.toLowerCase()
      if (!found.plugins && plugins.some((prefix) => lower.startsWith(prefix))) found.plugins = true
      if (
        !found.database &&
        databases.some((prefix) => lower.startsWith(prefix)) &&
        /\.db$/.test(lower)
      )
        found.database = true
    }
    holds = found
    known.set(source, holds)
  }
  return [holds.plugins ? 'Plug-ins' : '', holds.database ? "Live's plug-in database" : ''].filter(
    (name) => name,
  )
}

interface Given {
  readonly folder: FolderInput
  /** Where it is mounted while it is looked at. */
  readonly at: string
  /** Its plug-in folder, relative to it (`undefined`: it has none). */
  readonly plugins: string | undefined
}

/** The rows of every plug-in database file among the folders. */
async function databaseOf(fs: WebFs, given: readonly Given[]) {
  const plugins: DbPlugin[] = []
  const modules: DbModule[] = []
  let found = false
  for (const { at } of given) {
    for (const within of DATABASE_IN) {
      const dir = inside(at, within)
      const names = ((await fs.listDir(dir)) ?? [])
        .filter((entry) => !entry.isDirectory && DATABASE_FILE.test(entry.name))
        .map((entry) => entry.name)
        .sort()
      for (const name of names) {
        const path = posix.join(dir, name)
        try {
          // What Live scanned last may still be in the log beside the database.
          const wal =
            (await fs.kind(`${path}-wal`)) === 'file' ? await fs.readFile(`${path}-wal`) : undefined
          const read = parsePluginDatabase(await fs.readFile(path), wal)
          plugins.push(...read.plugins)
          modules.push(...read.modules)
          found = true
        } catch {} // not a database after all, or one that cannot be read: as if it were not there
      }
      if (names.length) break
    }
  }
  return { plugins, modules, found }
}

/**
 * Where a plug-in folder lies, by the paths Live's database names its bundles with: the place
 * that most of them lead into this folder from ('' = none does).
 */
async function placeOf(fs: WebFs, root: string, paths: readonly string[]): Promise<string> {
  const votes = new Map<string, number>()
  const seen = new Set<string>()
  for (const path of paths) {
    if (seen.has(path)) continue
    seen.add(path)
    for (const format of FORMATS) {
      const cut = path.indexOf(`/${format}/`)
      if (cut < 0) continue
      if ((await fs.kind(posix.join(root, path.slice(cut + 1)))) === undefined) continue
      const place = path.slice(0, cut)
      votes.set(place, (votes.get(place) ?? 0) + 1)
      break
    }
  }
  let best = ''
  for (const [place, count] of votes) if (count > (votes.get(best) ?? 0)) best = place
  return best
}

/**
 * The plug-ins the given folders show, and what Live's database says of them. `windows`: there
 * the database is all there is to read. Its rows count as they are: a plug-in is a file whose
 * place the page is not given, and there is one kind of processor.
 */
export async function installedIn(
  folders: readonly FolderInput[],
  windows = false,
): Promise<Installed> {
  const standIn = (i: number) => `/.given/${i}`
  const looked = new WebFs(
    folders.map((folder, i) => ({ path: standIn(i), source: folder.source })),
  )
  const given: Given[] = []
  for (const [i, folder] of folders.entries()) {
    let plugins: string | undefined
    for (const within of PLUGINS_IN) {
      const dir = inside(standIn(i), within)
      const has = await Promise.all(FORMATS.map((format) => looked.kind(posix.join(dir, format))))
      if (!has.includes('directory')) continue
      plugins = within
      break
    }
    given.push({ folder, at: standIn(i), plugins })
  }
  const read = await databaseOf(looked, given)
  // (Windows writes the paths with `\`.)
  const slash = <T extends { readonly path: string | null }>(row: T): T =>
    windows && row.path ? { ...row, path: posix.slashed(row.path) } : row
  const database = {
    found: read.found,
    plugins: read.plugins.map(slash),
    modules: read.modules.map(slash),
  }
  if (windows) {
    return {
      inventory: await loadInventory(new WebFs([]), {
        database: { plugins: database.plugins, modules: database.modules },
        pluginRoots: [],
        systemComponents: '',
        oneProcessor: true,
        unseenFiles: true,
      }),
      catalog: catalogOf(database.plugins),
      roots: [],
      database: database.found,
    }
  }
  const named = [...database.modules, ...database.plugins].flatMap((row) =>
    row.path ? [row.path] : [],
  )

  // Each folder with plug-ins where the database's paths place it; else at a path of its own.
  const taken = new Set<string>()
  const mounts: Mount[] = []
  const roots: string[] = []
  for (const { folder, at, plugins } of given) {
    if (plugins === undefined) continue
    const place = await placeOf(looked, inside(at, plugins), named)
    // The folder that was given may be one above the plug-in folder (`Library/Audio`).
    const above =
      plugins && place.endsWith(`/${plugins}`) ? place.slice(0, -plugins.length - 1) : ''
    let mount = plugins ? above : place
    if (!mount || taken.has(mount)) {
      const name = folder.source.name || 'Plug-Ins'
      mount = `/${name}`
      for (let n = 2; taken.has(mount); n++) mount = `/${name} ${n}`
    }
    taken.add(mount)
    mounts.push({ path: mount, source: folder.source })
    roots.push(inside(mount, plugins))
  }
  const inventory = await loadInventory(new WebFs(mounts), {
    database: { plugins: database.plugins, modules: database.modules },
    pluginRoots: roots,
    // (The Audio Units of macOS itself lie where a page is not given a folder: see below.)
    systemComponents: '',
  })
  return { inventory, catalog: catalogOf(database.plugins), roots, database: database.found }
}

/** The VST3 plug-ins among the database's rows, by class id. */
function catalogOf(plugins: readonly DbPlugin[]): Catalog {
  return addCatalogRows(
    new Map(),
    plugins.map((row) => ({ devIdentifier: row.devIdentifier ?? '', name: row.name ?? '' })),
  )
}

/**
 * The Audio Units of Apple come with macOS and lie in a system folder a page is not given: one
 * that a set uses is taken to be there. (livesaver on the computer asks the system for them.)
 */
export function withAppleUnits(inventory: Inventory, used: readonly PluginRef[]): Inventory {
  const apple: InstalledPlugin[] = []
  const added = new Set<string>()
  for (const ref of used) {
    if (ref.format !== 'AU' || !ref.ident.endsWith(':appl') || added.has(ref.ident)) continue
    if (inventory.get('AU', ref.ident).length) continue
    added.add(ref.ident)
    apple.push({
      format: 'AU',
      ident: ref.ident,
      name: ref.name,
      path: '',
      native: undefined,
      scanned: false,
    })
  }
  return apple.length
    ? new Inventory([...inventory.all, ...apple], inventory.failed, inventory.bundles)
    : inventory
}
