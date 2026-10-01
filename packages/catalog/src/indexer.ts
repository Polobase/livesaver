/**
 * Keep the catalog up to date with folders of sets. A set is read (on worker threads) only when its
 * file changed (size, modification and change time, inode); for all others the stored references
 * are resolved again and the plug-in states looked up again, which needs no parsing and keeps
 * "missing" answers current when samples or plug-ins were added or removed.
 */
import {
  type FileStat,
  type Host,
  type InspectedSet,
  inProcessParser,
  posix,
  type SetParser,
} from '@livesaver/core'
import {
  DEFAULT_PROFILE,
  type EnvConfig,
  Environment,
  findSets,
  mapLimited,
  PROJECT_MARKER,
  Probe,
  projectRootOf,
  resolveExisting,
  stageOf,
} from '@livesaver/ops'
import type { Inventory } from '@livesaver/plugins'
import {
  type Catalog,
  isBelow,
  type SetIdentity,
  type SetRecord,
  type StoredPlugin,
  type StoredRef,
} from './catalog.js'

export interface IndexOptions {
  readonly targets: readonly string[]
  readonly excludes?: readonly string[]
  readonly env: EnvConfig
  readonly inventory: Inventory
  /** Worker threads for reading sets (default: in-process). */
  readonly parser?: SetParser
  /** Read every set again, changed or not. */
  readonly full?: boolean
  readonly onProgress?: (done: number, total: number) => void
}

export interface IndexResult {
  readonly sets: number
  /** Sets read (new or changed). */
  readonly read: number
  /** Sets only re-checked (unchanged files). */
  readonly unchanged: number
  /** Sets gone from the folders (removed from the catalog). */
  readonly removed: number
  readonly unreadable: number
  readonly ms: number
}

function identityOf(stat: FileStat): SetIdentity {
  return {
    size: stat.size,
    mtimeNs: String(stat.mtimeNs),
    ctimeNs: String(stat.ctimeNs),
    ino: String(stat.ino),
    dev: String(stat.dev),
  }
}

function sameIdentity(a: SetIdentity, b: SetIdentity): boolean {
  return (
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs &&
    a.ino === b.ino &&
    a.dev === b.dev
  )
}

function pluginsOf(
  inspected: Extract<InspectedSet, { ok: true }>,
  inventory: Inventory,
): StoredPlugin[] {
  return inspected.info.plugins.map(({ ref, instances }) => ({
    format: ref.format,
    ident: ref.ident,
    name: ref.name,
    instances,
    state: inventory.status(ref).state,
  }))
}

/** Update the catalog for the sets below `targets`. */
export async function indexSets(
  host: Host,
  catalog: Catalog,
  options: IndexOptions,
): Promise<IndexResult> {
  const started = performance.now()
  const probe = new Probe(host.fs, host.hash)
  const env = new Environment(options.env, probe)
  const sets = await findSets(options.targets, options.excludes ?? [], probe)
  const stored = catalog.identities(options.targets)
  const stats = await mapLimited(sets, 32, (s) => host.fs.stat(s))
  const toRead: number[] = []
  const unchanged: number[] = []
  for (const [i, path] of sets.entries()) {
    const stat = stats[i]
    const known = stored.get(path)
    if (!options.full && stat && known && sameIdentity(known, identityOf(stat))) unchanged.push(i)
    else toRead.push(i)
  }

  const resolve = async (ref: Omit<StoredRef, 'resolved'>, setPath: string, root: string) =>
    (await resolveExisting(ref, posix.dirname(setPath), root, env, probe)) ?? ''

  const parser = options.parser ?? inProcessParser(host)
  const inspect =
    parser.inspect?.bind(parser) ??
    (inProcessParser(host).inspect as NonNullable<SetParser['inspect']>)
  let done = 0
  const total = sets.length
  const records = await mapLimited(toRead, 16, async (i): Promise<SetRecord> => {
    const path = sets[i] as string
    const inspected = await inspect(path)
    const root = await projectRootOf(path, probe)
    const isProject = await probe.isDir(posix.join(root, PROJECT_MARKER))
    const stat = inspected.stat ?? stats[i]
    const identity = stat
      ? identityOf(stat)
      : { size: 0, mtimeNs: '0', ctimeNs: '0', ino: '0', dev: '0' }
    const base = {
      path,
      project: root,
      isProject,
      name: posix.splitext(posix.basename(path))[0],
      ...identity,
      mtime: stat ? Number(stat.mtimeNs / 1_000_000_000n) : 0,
    }
    options.onProgress?.(++done, total)
    if (!inspected.ok)
      return {
        ...emptyMeasures(),
        ...base,
        error: inspected.error,
        stage: 'error',
        plugins: [],
        refs: [],
      }
    const info = inspected.info
    const refs: StoredRef[] = []
    const seen = new Set<string>()
    for (const ref of inspected.refs) {
      if (!ref.name || seen.has(ref.key)) continue
      seen.add(ref.key)
      const stored: Omit<StoredRef, 'resolved'> = {
        kind: ref.kind,
        name: ref.name,
        key: ref.key,
        relType: ref.relType,
        relPath: ref.relPath,
        path: ref.path,
        hintPath: ref.hintPath,
        packName: ref.packName,
        packId: ref.packId,
        size: ref.size,
        crc: ref.crc,
      }
      refs.push({ ...stored, resolved: await resolve(stored, path, root) })
    }
    return {
      ...base,
      error: '',
      creator: info.creator,
      live: info.version,
      major: info.major,
      tempo: info.tempo,
      signature: `${info.signature[0]}/${info.signature[1]}`,
      lengthBeats: info.lengthBeats,
      seconds: info.seconds,
      bars: info.bars,
      startBar: info.startBar,
      tracks: Object.values(info.tracks).reduce((a, b) => a + b, 0),
      audioTracks: info.tracks.AudioTrack ?? 0,
      midiTracks: info.tracks.MidiTrack ?? 0,
      groupTracks: info.tracks.GroupTrack ?? 0,
      returnTracks: info.tracks.ReturnTrack ?? 0,
      namedTracks: info.namedTracks,
      arrangementClips: info.arrangementClips,
      arrangementTracks: info.arrangementTracks,
      sessionClips: info.sessionClips,
      scenes: info.scenes,
      scenesUsed: info.scenesUsed,
      blocks: info.blocks,
      distinctBlocks: info.distinctBlocks,
      automated: info.automated,
      locators: info.locators,
      masterDevices: info.masterDevices,
      contentHash: info.contentHash,
      stage: stageOf(info, DEFAULT_PROFILE),
      plugins: pluginsOf(inspected, options.inventory),
      refs,
    }
  })

  // Unchanged sets: resolve their stored references and look up their plug-ins again.
  const refreshed = await mapLimited(unchanged, 16, async (i) => {
    const path = sets[i] as string
    const id = (stored.get(path) as { id: number }).id
    const root = await projectRootOf(path, probe)
    const refs = catalog.refs(id)
    const plugins = catalog.plugins(id)
    const before = { refs: refs.map((r) => r.resolved), plugins: plugins.map((p) => p.state) }
    for (const r of refs) r.resolved = await resolve(r, path, root)
    for (const p of plugins)
      p.state = options.inventory.status({
        format: p.format as never,
        ident: p.ident,
        name: p.name,
      }).state
    options.onProgress?.(++done, total)
    return { id, refs, plugins, before }
  })

  const present = new Set(sets)
  let removed = 0
  catalog.transaction(() => {
    for (const r of records) catalog.put(r)
    for (const r of refreshed) catalog.refresh(r.id, r.refs, r.plugins, r.before)
    for (const path of stored.keys()) {
      if (present.has(path)) continue
      if ((options.excludes ?? []).some((x) => isBelow(path, x))) continue
      catalog.remove(path)
      removed++
    }
    if (records.length || removed) catalog.prune()
  })
  return {
    sets: sets.length,
    read: records.length,
    unchanged: refreshed.length,
    removed,
    unreadable: records.filter((r) => r.error).length,
    ms: performance.now() - started,
  }
}

function emptyMeasures(): Omit<
  SetRecord,
  | 'path'
  | 'project'
  | 'isProject'
  | 'name'
  | 'mtime'
  | 'size'
  | 'mtimeNs'
  | 'ctimeNs'
  | 'ino'
  | 'dev'
  | 'error'
  | 'stage'
  | 'plugins'
  | 'refs'
> {
  return {
    creator: '',
    live: '',
    major: 0,
    tempo: 0,
    signature: '',
    lengthBeats: 0,
    seconds: 0,
    bars: 0,
    startBar: 0,
    tracks: 0,
    audioTracks: 0,
    midiTracks: 0,
    groupTracks: 0,
    returnTracks: 0,
    namedTracks: 0,
    arrangementClips: 0,
    arrangementTracks: 0,
    sessionClips: 0,
    scenes: 0,
    scenesUsed: 0,
    blocks: 0,
    distinctBlocks: 0,
    automated: 0,
    locators: [],
    masterDevices: [],
    contentHash: '',
  }
}
