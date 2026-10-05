/** Run the whole pipeline over folders of sets (without writing the report files). */
import {
  type Host,
  inProcessParser,
  liveMajor,
  type ParsedSet,
  posix,
  type SetParser,
} from '@livesaver/core'
import type { CompleteSets } from './cache.js'
import {
  type CollectOptions,
  DEFAULT_PACK_LIMIT,
  DRY_RUN,
  emptyCounts,
  findSets,
  isComplete,
  Project,
  projectRootOf,
  type SetResult,
  type Writer,
} from './collect.js'
import { type EnvConfig, Environment } from './env.js'
import { FileIndex } from './file-index.js'
import { Probe } from './probe.js'
import { processSet } from './process.js'

export interface DoctorOptions {
  /** Project folders, folders of projects, or single .als files (absolute paths). */
  readonly targets: readonly string[]
  readonly searchRoots: readonly string[]
  /** Folders not used for the sample search. */
  readonly ignore?: readonly string[]
  /** Folders whose sets are not processed. */
  readonly excludes?: readonly string[]
  readonly env: EnvConfig
  readonly packCopyLimit?: number
  /** Accept vendor library files by name and place in the library (see `ChooseOptions`). */
  readonly matchLibraryPath?: boolean
  /** Leave uncertain matches out: their references stay missing (see `ChooseOptions`). */
  readonly certainOnly?: boolean
  /**
   * Sets that were last saved by a Live older than this major version are left out: not
   * checked, not listed, not fixed (0 or absent: every set). For old saves that are kept as
   * they were beside newer ones of the same song.
   */
  readonly minLive?: number
  readonly writer?: Writer
  readonly keepXml?: boolean
  /** Dry runs skip the strict scan of patched sets (see `ProcessOptions`). */
  readonly quickPlan?: boolean
  readonly onEvent?: (event: DoctorEvent) => void
  /** Reads sets ahead of the (ordered) decisions; defaults to parsing in-process. */
  readonly parser?: SetParser
  /** How many sets are read ahead (default 16). */
  readonly lookahead?: number
  /** Share the file-system cache with the caller (writers, reports). */
  readonly probe?: Probe
  /** Skip sets that were complete and unchanged; updated as sets are processed. */
  readonly cache?: CompleteSets
}

export type DoctorEvent =
  | { readonly type: 'index'; readonly files: number; readonly roots: number; readonly ms: number }
  | { readonly type: 'sets'; readonly count: number }
  | {
      readonly type: 'set'
      readonly index: number
      readonly total: number
      readonly result: SetResult
    }

export interface DoctorResult {
  readonly results: SetResult[]
  readonly projects: Project[]
  readonly index: FileIndex
  /** Common folder of the targets (report paths are shown relative to it). */
  readonly base: string
  readonly ms: number
  /** Sets that were left out for the Live that saved them (see `DoctorOptions.minLive`). */
  readonly leftOut: number
}

export async function doctor(host: Host, options: DoctorOptions): Promise<DoctorResult> {
  const started = performance.now()
  const probe = options.probe ?? new Probe(host.fs, host.hash)
  const env = new Environment(options.env, probe)
  const collect: CollectOptions = {
    packCopyLimit: options.packCopyLimit ?? DEFAULT_PACK_LIMIT,
    matchLibraryPath: options.matchLibraryPath ?? false,
    certainOnly: options.certainOnly ?? false,
  }
  const writer = options.writer ?? DRY_RUN

  const index = await FileIndex.build(options.searchRoots, probe, { ignore: options.ignore ?? [] })
  options.onEvent?.({
    type: 'index',
    files: index.fileCount,
    roots: index.roots.length,
    ms: performance.now() - started,
  })

  let base = posix.commonpath(options.targets)
  if (await probe.isFile(base)) base = posix.dirname(base)
  const sets = await findSets(options.targets, options.excludes ?? [], probe)
  options.onEvent?.({ type: 'sets', count: sets.length })

  const cache = options.cache
  const cached = cache ? await Promise.all(sets.map((path) => cache.lookup(path, probe))) : []
  const parser = options.parser ?? inProcessParser(host)
  const lookahead = Math.max(1, options.lookahead ?? 16)
  const pending = new Map<number, Promise<ParsedSet>>()
  const request = (i: number) => {
    const path = sets[i]
    if (path !== undefined && !cached[i] && !pending.has(i)) pending.set(i, parser.parse(path))
  }

  const projects = new Map<string, Project>()
  const results: SetResult[] = []
  const minLive = options.minLive ?? 0
  /** Saved by a Live older than asked for (a set that does not say which is not). */
  const tooOld = (creator: string) => {
    const major = liveMajor(creator)
    return major > 0 && major < minLive
  }
  let leftOut = 0
  for (const [i, setPath] of sets.entries()) {
    for (let k = i; k < i + lookahead; k++) request(k)
    const hit = cached[i]
    // Read like the others, so that the Live that saved it is known; then left alone.
    const parsed = hit ? undefined : await (pending.get(i) as Promise<ParsedSet>)
    pending.delete(i)
    if (tooOld(hit ? hit.creator : parsed?.ok ? parsed.doc.creator : '')) {
      leftOut++
      continue
    }
    const root = await projectRootOf(setPath, probe)
    let project = projects.get(root)
    if (!project) {
      project = new Project(root, index, env, probe, collect, writer)
      projects.set(root, project)
    }
    if (hit) {
      const result: SetResult = {
        setPath,
        projectRoot: root,
        creator: hit.creator,
        minorVersion: '',
        counts: { ...emptyCounts(), ...hit.counts },
        changes: [],
        missing: [],
        files: [...hit.files],
        decisions: [],
        backup: '',
        written: false,
        error: '',
        skipped: true,
      }
      results.push(result)
      options.onEvent?.({ type: 'set', index: i + 1, total: sets.length, result })
      continue
    }
    if (!parsed) continue
    const result = await processSet(setPath, project, host, {
      keepXml: options.keepXml ?? false,
      quickPlan: options.quickPlan ?? false,
      parsed,
    })
    if (cache) {
      if (isComplete(result) && result.changes.length === 0 && parsed.ok && parsed.stat) {
        cache.store(setPath, parsed.stat, result.creator, result.counts, result.files)
      } else {
        cache.forget(setPath)
      }
    }
    results.push(result)
    options.onEvent?.({ type: 'set', index: i + 1, total: sets.length, result })
  }
  if (!options.parser) await parser.close()
  return {
    results,
    projects: [...projects.values()],
    index,
    base,
    ms: performance.now() - started,
    leftOut,
  }
}
