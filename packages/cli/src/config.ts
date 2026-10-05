/**
 * Where to look: Live's locations, search roots and options, from (lowest to highest priority)
 * discovery of the local Live setup, ~/.config/livesaver/config.json, and CLI flags.
 */
import { existsSync, readFileSync } from 'node:fs'
import { EMPTY_REMAP } from '@livesaver/core'
import {
  findLiveInstalls,
  type LiveInstall,
  readLibraryConfig,
  readRemapTable,
} from '@livesaver/node'
import {
  customProfile,
  DEFAULT_PROFILE,
  type EnvConfig,
  type StageKey,
  type StatusDecision,
  type StatusProfile,
  type TagKey,
  type Thresholds,
} from '@livesaver/ops'
import { dirname, home, join, resolve, windowsFolder } from './paths.js'

/**
 * `status`, `reorg` and the rating sheet (all optional). Names replace those of the default
 * profile; keep them fixed once used, since livesaver only replaces tags it knows as its own.
 */
export interface StatusConfig {
  /** The rating sheet (CSV) to take entries from and rewrite; false: none. */
  readonly sheet?: string | false
  /** Folder with mixdowns. */
  readonly exports?: string
  /** Folder that holds the status folders (`reorg`). */
  readonly projects?: string
  readonly stages?: Partial<Record<StageKey, string>>
  readonly tags?: Partial<Record<TagKey, string>>
  /** First word of the comment of an unreadable set. */
  readonly error?: string
  readonly decisions?: readonly StatusDecision[]
  readonly stars?: readonly string[]
  readonly thresholds?: Partial<Thresholds>
}

export interface FileConfig {
  readonly status?: StatusConfig
  readonly userLibrary?: string
  readonly factoryPacks?: string
  readonly appResources?: string
  readonly preferredRoots?: readonly string[]
  readonly vendorLibraries?: readonly string[]
  readonly searchRoots?: readonly string[]
  readonly packLimitMB?: number
}

export const CONFIG_PATH = join(home(), '.config', 'livesaver', 'config.json')

export function expandHome(path: string): string {
  // (On Windows a path may be typed with `\`.)
  return path === '~' ? home() : /^~[/\\]/.test(path) ? join(home(), path.slice(2)) : path
}

/** A path as it was typed, as livesaver handles paths (see `paths.ts`). */
export function absolute(path: string): string {
  return resolve(expandHome(path))
}

const windows = process.platform === 'win32'
/**
 * Where Live keeps the User Library and the Factory Packs unless its settings say otherwise,
 * and where vendors install their libraries (Native Instruments). On Windows as Ableton and
 * Native Instruments document it.
 */
const ABLETON_FOLDER = windows
  ? join(home(), 'Documents', 'Ableton')
  : join(home(), 'Music', 'Ableton')
const VENDOR_FOLDER = windows
  ? join(windowsFolder('PUBLIC', 'C:/Users/Public'), 'Documents')
  : '/Users/Shared'

export function readFileConfig(path = CONFIG_PATH): FileConfig {
  if (!existsSync(path)) return {}
  return JSON.parse(readFileSync(path, 'utf8')) as FileConfig
}

export interface ResolvedConfig {
  readonly env: EnvConfig
  readonly searchRoots: readonly string[]
  readonly packCopyLimit: number
  readonly install: LiveInstall | undefined
  readonly sources: readonly string[]
}

export interface CliOverrides {
  readonly config?: string
  readonly search?: readonly string[]
  readonly noDefaultSearch?: boolean
  readonly packLimit?: number
  readonly targets?: readonly string[]
}

function mostCommon(values: readonly string[]): string | undefined {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
}

export async function resolveConfig(overrides: CliOverrides = {}): Promise<ResolvedConfig> {
  const sources: string[] = []
  const installs = await findLiveInstalls()
  const install = installs[0]
  const file = readFileConfig(overrides.config ? absolute(overrides.config) : CONFIG_PATH)
  if (Object.keys(file).length) sources.push(overrides.config ?? CONFIG_PATH)

  // Discovered defaults: Library.cfg for the User Library and pack folder.
  const library = await readLibraryConfig(install?.version)
  const musicAbleton = ABLETON_FOLDER
  const discoveredLibrary = library?.userLibrary ?? join(musicAbleton, 'User Library')
  const packDirs = (library?.packs ?? []).map((p) => dirname(p.path)).filter((p) => p !== '.')
  const vendor = existsSync(VENDOR_FOLDER) ? [VENDOR_FOLDER] : []
  const base: Required<Omit<FileConfig, 'status'>> = {
    userLibrary: discoveredLibrary,
    factoryPacks: mostCommon(packDirs) ?? join(musicAbleton, 'Factory Packs'),
    appResources: install?.appResources ?? '',
    preferredRoots: [],
    vendorLibraries: vendor,
    searchRoots: [
      ...(overrides.targets ?? []),
      dirname(discoveredLibrary),
      install?.appResources ? join(install.appResources, 'Core Library') : '',
      ...vendor,
    ].filter((p) => p),
    packLimitMB: 50,
  }
  sources.push(library ? `discovered (${library.preferences})` : 'discovered')

  const pick = <K extends keyof typeof base>(key: K) =>
    (file[key] as (typeof base)[K] | undefined) ?? base[key]
  const userLibrary = absolute(pick('userLibrary'))
  const factoryPacks = absolute(pick('factoryPacks'))
  const appResources = pick('appResources') ? absolute(pick('appResources')) : ''
  const preferredRoots = pick('preferredRoots').map(absolute)
  const vendorLibraries = pick('vendorLibraries').map(absolute)
  const defaults = overrides.noDefaultSearch ? [] : pick('searchRoots').map(absolute)
  const searchRoots = [...defaults, ...(overrides.search ?? []).map(absolute)]
  const packLimitMB = overrides.packLimit ?? pick('packLimitMB')
  const remap = appResources ? await readRemapTable(appResources) : EMPTY_REMAP

  return {
    env: { userLibrary, factoryPacks, appResources, preferredRoots, vendorLibraries, remap },
    searchRoots,
    packCopyLimit: Math.trunc(packLimitMB * 1_000_000),
    install,
    sources,
  }
}

export interface ResolvedStatus {
  readonly profile: StatusProfile
  /** The rating sheet, if one is used. */
  readonly sheet: string | undefined
  readonly exports: string
  readonly projects: string | undefined
}

export interface StatusOverrides {
  readonly config?: string
  /** A sheet path, or false for none. */
  readonly sheet?: string | false
  readonly exports?: string
  readonly projects?: string
}

/** Names and paths for `status`/`reorg`, from the config file and CLI flags. */
export function resolveStatusConfig(overrides: StatusOverrides = {}): ResolvedStatus {
  const file = readFileConfig(overrides.config ? absolute(overrides.config) : CONFIG_PATH)
  const own = file.status ?? {}
  const profile = customProfile(DEFAULT_PROFILE, {
    ...(own.stages ? { stages: own.stages } : {}),
    ...(own.tags ? { tags: own.tags } : {}),
    ...(own.error ? { error: own.error } : {}),
    ...(own.decisions ? { decisions: own.decisions } : {}),
    ...(own.stars ? { stars: own.stars } : {}),
    ...(own.thresholds ? { thresholds: own.thresholds } : {}),
  })
  const sheet = overrides.sheet ?? own.sheet
  const projects = overrides.projects ?? own.projects
  const exports = overrides.exports ?? own.exports
  return {
    profile,
    sheet: sheet ? absolute(sheet) : undefined,
    exports: exports ? absolute(exports) : '',
    projects: projects ? absolute(projects) : undefined,
  }
}
