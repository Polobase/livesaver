/**
 * Resolve sample references the way Live does, and pick the right replacement for missing ones.
 */
import {
  CORE_LIBRARY_PACK_ID,
  codePointLength,
  compareCodePoints,
  type FileRef,
  norm,
  posix,
  REL_BUILTIN,
  REL_DOCUMENT,
  REL_PACK,
  REL_PROJECT,
  REL_USER_LIBRARY,
  storedPaths,
} from '@livesaver/core'
import { type Environment, isInside, joinIf } from './env.js'
import type { FileIndex } from './file-index.js'
import type { Probe } from './probe.js'

export type Status = 'ok' | 'kept' | 'external' | 'found' | 'not-found' | 'ambiguous' | 'mismatch'
export const MISSING_STATES: readonly Status[] = ['not-found', 'ambiguous', 'mismatch']

/** Vendors appended a padding byte or ~1.5 KB of metadata when they re-saved library files. */
export const MAX_VENDOR_GROWTH = 8192

/**
 * `matchLibraryPath` accepts a library file whose fingerprint differs when it has the same place in
 * the library: the file name plus three folders (`Samples/Drums/Shaker/Shaker 1.wav`), so a library
 * whose top folder was renamed between versions still counts.
 */
export const LIBRARY_PATH_LEVELS = 4
/** New tags change a file's size by a few bytes; a larger difference is other audio. */
export const LIBRARY_PATH_BYTES = 16

export interface ChooseOptions {
  /**
   * Accept a vendor library file by its name and place in the library when no fingerprint matches.
   * Vendors re-tagged samples between library versions; in a sample shorter than the 16 KB of
   * Live's CRC the tags are part of the fingerprint, so the installed file can never match it.
   * The audio cannot be confirmed, so such a choice is unverified.
   */
  readonly matchLibraryPath?: boolean
  /**
   * Take a file only if the stored fingerprint confirms it. One found by other evidence (the same
   * size in a pack, its place in a library, a reference that stores no fingerprint) is then left
   * alone: the reference stays missing, reported like a file with other content, with the file
   * as its candidate.
   */
  readonly certainOnly?: boolean
}

const APP_RESOURCES_RE = /^\/Applications\/Ableton Live [^/]*\.app\/Contents\/App-Resources\/(.+)$/

/** What `resolveExisting` reads of a reference (a stored copy is enough, no parsed set needed). */
export type RefLocation = Pick<
  FileRef,
  'relPath' | 'relType' | 'packId' | 'packName' | 'path' | 'hintPath'
>

/** The existing file a reference points to, found the way Live would find it. */
export async function resolveExisting(
  ref: RefLocation,
  setDir: string,
  projectRoot: string,
  env: Environment,
  probe: Probe,
): Promise<string | undefined> {
  const tries: string[] = []
  const rel = ref.relPath
  if (rel) {
    switch (ref.relType) {
      case REL_PROJECT:
        tries.push(joinIf(projectRoot, rel), joinIf(setDir, rel))
        break
      case REL_DOCUMENT:
        tries.push(joinIf(setDir, rel), joinIf(projectRoot, rel))
        break
      case REL_PACK:
        if (ref.packId === CORE_LIBRARY_PACK_ID || ref.packName === 'Core Library') {
          tries.push(joinIf(env.coreLibrary, rel))
        } else if (ref.packName) {
          tries.push(joinIf(env.factoryPacks, ref.packName, rel))
        }
        break
      case REL_USER_LIBRARY:
        tries.push(joinIf(env.userLibrary, rel))
        break
      case REL_BUILTIN:
        tries.push(joinIf(env.builtin, rel))
        break
    }
  }
  for (const path of storedPaths(ref)) {
    if (posix.isWindowsPath(path)) continue
    if (posix.isAbs(path)) {
      tries.push(path)
      const m = APP_RESOURCES_RE.exec(path) // file of an older, uninstalled Live version
      if (m) tries.push(joinIf(env.appResources, m[1] as string))
    } else {
      // Relative Path with RelativePathType 0 (occurs in real sets).
      tries.push(joinIf(projectRoot, path), joinIf(setDir, path), joinIf(env.coreLibrary, path))
    }
  }
  if (rel) tries.push(env.remapped(ref.relType, ref.packId, rel))
  for (const path of tries) {
    if (path && (await probe.isFile(path))) return posix.normpath(path)
  }
  return undefined
}

export type Location = 'project' | 'pack' | 'builtin' | 'external'

export function classify(path: string, projectRoot: string, env: Environment): Location {
  if (isInside(path, projectRoot)) return 'project'
  if (env.isPackFile(path)) return 'pack'
  if (env.appResources && isInside(path, env.appResources)) return 'builtin'
  return 'external'
}

export type Check = 'vendor-update' | 'fingerprint' | 'size-only' | 'library-path' | 'none'

export interface Choice {
  readonly status: Status
  readonly path: string
  /** Number of matching trailing path components. */
  readonly suffix: number
  /** The size/CRC fingerprint matched. */
  readonly verified: boolean
  /** Verified after undoing a vendor's size change in the file header. */
  readonly vendorUpdate: boolean
  /** Pack sample whose size matched but CRC not (Ableton updated the file). */
  readonly sizeOnly: boolean
  /** Library file with another fingerprint, accepted by its name and place in the library. */
  readonly libraryPath: boolean
  readonly candidates: readonly string[]
}

function choice(status: Status, extra: Partial<Choice> = {}): Choice {
  return {
    status,
    path: '',
    suffix: 0,
    verified: false,
    vendorUpdate: false,
    sizeOnly: false,
    libraryPath: false,
    candidates: [],
    ...extra,
  }
}

export function checkOf(c: Choice): Check {
  if (c.vendorUpdate) return 'vendor-update'
  if (c.verified) return 'fingerprint'
  if (c.sizeOnly) return 'size-only'
  if (c.libraryPath) return 'library-path'
  return 'none'
}

/** How a file was found, e.g. "fingerprint ok, path end 3 level(s)" (reports). */
export function methodText(c: Choice): string {
  const text = {
    'vendor-update': 'fingerprint ok (vendor update, file slightly larger)',
    fingerprint: 'fingerprint ok',
    'size-only': 'same size only (pack update)',
    'library-path': 'name and library path only (other fingerprint)',
    none: 'no fingerprint',
  }[checkOf(c)]
  return `${text}, path end ${c.suffix} level(s)`
}

/** Sample from an Ableton pack or the Core Library; Ableton updated those files in place. */
export function isPackSample(ref: FileRef): boolean {
  if (ref.packName || ref.relType === REL_PACK) return true
  const location = (ref.path || ref.hintPath).toLowerCase()
  return location.includes('core library') || location.includes('factory packs')
}

export function originalParts(ref: FileRef): string[] {
  const source = ref.path || ref.hintPath || ref.relPath
  return posix
    .splitPath(source)
    .filter((c) => c !== '..')
    .map(norm)
}

export function suffixLength(wanted: readonly string[], candidate: string): number {
  const parts = posix.splitPath(candidate).map(norm)
  let n = 0
  while (
    n < wanted.length &&
    n < parts.length &&
    wanted[wanted.length - 1 - n] === parts[parts.length - 1 - n]
  )
    n++
  return n
}

function priority(path: string, projectRoot: string, env: Environment): [number, number, string] {
  const roots = [projectRoot, ...env.config.preferredRoots]
  let rank = roots.findIndex((root) => root && isInside(path, root))
  if (rank < 0) rank = roots.length
  return [rank, codePointLength(path), path]
}

/**
 * Pick the replacement for a missing sample or Max device:
 * 1. candidates with the same file name anywhere in the search roots;
 * 2. the stored fingerprint must match if known (vendor re-saves and, for pack samples, the same
 *    size count too; with `matchLibraryPath` also the same place in a vendor library); Max devices
 *    need the exact fingerprint;
 * 3. the longest matching path ending wins;
 * 4. several winners are fine only if their audio data is identical.
 */
export async function choose(
  ref: FileRef,
  index: FileIndex,
  projectRoot: string,
  env: Environment,
  probe: Probe,
  options: ChooseOptions = {},
): Promise<Choice> {
  const candidates = index.candidates(ref.name)
  if (candidates.length === 0) return choice('not-found')
  const device = ref.kind === 'device'
  const wanted = originalParts(ref)
  let verified = ref.size > 0
  let vendorUpdate = false
  let sizeOnly = false
  let libraryPath = false
  let good: string[] = candidates
  if (verified) {
    const prints = await Promise.all(
      candidates.map(async (c) => [c, await probe.fingerprint(c)] as const),
    )
    good = prints
      .filter(([, fp]) => fp && fp[0] === ref.size && (!ref.crc || fp[1] === ref.crc))
      .map(([c]) => c)
    if (good.length === 0 && ref.crc && !device) {
      const vendor: string[] = []
      for (const [c, fp] of prints) {
        if (!fp) continue
        const delta = Math.abs(fp[0] - ref.size)
        if (
          delta > 0 &&
          delta <= MAX_VENDOR_GROWTH &&
          env.isVendorFile(c) &&
          (await probe.resizedCrcs(c, ref.size)).has(ref.crc)
        ) {
          vendor.push(c)
        }
      }
      good = vendor
      vendorUpdate = good.length > 0
    }
    if (good.length === 0 && !device) {
      // Ableton pack samples: Ableton changed pack files in place, the same size is enough.
      const packRef = isPackSample(ref)
      good = prints
        .filter(([c, fp]) => fp && fp[0] === ref.size && (packRef || env.isPackFile(c)))
        .map(([c]) => c)
      verified = false
      sizeOnly = true
    }
    if (good.length === 0 && !device && options.matchLibraryPath) {
      good = prints
        .filter(
          ([c, fp]) =>
            fp &&
            Math.abs(fp[0] - ref.size) <= LIBRARY_PATH_BYTES &&
            env.isVendorFile(c) &&
            suffixLength(wanted, c) >= LIBRARY_PATH_LEVELS,
        )
        .map(([c]) => c)
      sizeOnly = false
      libraryPath = true
    }
  } else if (device) {
    const hashes = new Set(await Promise.all(candidates.map((c) => probe.contentHash(c))))
    if (hashes.size > 1) return choice('ambiguous', { candidates })
  }
  if (good.length === 0) return choice('mismatch', { candidates })
  const scored = good.map((c) => [suffixLength(wanted, c), c] as const)
  const best = Math.max(...scored.map(([score]) => score))
  const top = scored.filter(([score]) => score === best).map(([, c]) => c)
  const flags = { suffix: best, verified, vendorUpdate, sizeOnly, libraryPath }
  if (top.length > 1) {
    const hashes = new Set(await Promise.all(top.map((c) => probe.audioHash(c))))
    if (hashes.size > 1) return choice('ambiguous', { candidates: top, ...flags })
  }
  const ranked = top
    .map((c) => ({ c, key: priority(c, projectRoot, env) }))
    .sort(
      (a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || compareCodePoints(a.key[2], b.key[2]),
    )
  const path = (ranked[0] as { c: string }).c
  if (options.certainOnly && !verified) return choice('mismatch', { candidates: [path], ...flags })
  return choice('found', { path, ...flags })
}
