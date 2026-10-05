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

/**
 * A file in the resources of a Live that may no longer be installed: of the app on a Mac, or of
 * the program's folder on Windows (as Ableton documents it; not seen in a set).
 */
const APP_RESOURCES_RE =
  /^(?:\/Applications\/Ableton Live [^/]*\.app\/Contents\/App-Resources|[A-Za-z]:\/ProgramData\/Ableton\/Live [^/]*\/Resources)\/(.+)$/

/** What `resolveExisting` reads of a reference (a stored copy is enough, no parsed set needed). */
export type RefLocation = Pick<
  FileRef,
  'relPath' | 'relType' | 'packId' | 'packName' | 'path' | 'hintPath'
>

/** Where the file of a reference is looked for, in the order Live would look. */
export function expectedPlaces(
  ref: RefLocation,
  setDir: string,
  projectRoot: string,
  env: Environment,
): string[] {
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
  // A path of Windows is a path of this computer where the project itself lies on a drive.
  // Elsewhere no such file can be opened, and the path is one of a computer of long ago.
  const onWindows = posix.drive(projectRoot) !== ''
  for (const stored of storedPaths(ref)) {
    if (posix.isWindowsPath(stored) && !onWindows) continue
    // (A set of Live 9 or 10 stores it with backslashes, Live 11 and later with slashes.)
    const path = posix.slashed(stored)
    if (posix.isAbs(path)) {
      // A path of a Mac is no file on Windows either, though Windows would open `/Users/me/x.wav`
      // as a file of its current drive: Live does not find it there. What such a path says of
      // Live's own content still holds.
      if (posix.drive(path) !== '' || !onWindows) tries.push(path)
      const m = APP_RESOURCES_RE.exec(path) // file of an older, uninstalled Live version
      if (m) tries.push(joinIf(env.appResources, m[1] as string))
    } else {
      // Relative Path with RelativePathType 0 (occurs in real sets).
      tries.push(joinIf(projectRoot, path), joinIf(setDir, path), joinIf(env.coreLibrary, path))
    }
  }
  if (rel) tries.push(env.remapped(ref.relType, ref.packId, rel))
  return tries.filter((path) => path)
}

/** The existing file a reference points to, found the way Live would find it. */
export async function resolveExisting(
  ref: RefLocation,
  setDir: string,
  projectRoot: string,
  env: Environment,
  probe: Probe,
): Promise<string | undefined> {
  for (const path of expectedPlaces(ref, setDir, projectRoot, env)) {
    if (await probe.isFile(path)) return posix.normpath(path)
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

/**
 * Why a host leaves a reference as it is, though it need not be missing (a browser, for a folder
 * it hands a page): `unseen`, it shows no file at a place the set names, so the file may well be
 * there; `unmade`, a file was found, and the host can make no file of that name in the project;
 * `locked`, a file was found, and the host cannot rewrite the set.
 */
export type Blind = 'unseen' | 'unmade' | 'locked'

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
  /**
   * Of a reference that stays missing because nothing confirms a file: the library file that
   * `matchLibraryPath` would take ('' = none, or the rule is on). It is what a user is told
   * who has the library installed in another version than the set remembers.
   */
  readonly libraryFile: string
  /** Of a reference that is left as it is because of what the host cannot do ('' = it is not). */
  readonly blind: Blind | ''
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
    libraryFile: '',
    blind: '',
    ...extra,
  }
}

/** A reference that stays unresolved because of the host (see `Choice.blind`). */
export function leftBlind(blind: Blind, candidates: readonly string[] = []): Choice {
  return choice('not-found', { blind, candidates })
}

const BLIND_TEXT: Readonly<Record<Blind, string>> = {
  unseen: 'cannot be seen here: the file may be where the set expects it',
  unmade: 'found, but no file of this name can be made here',
  locked: 'found, but the set cannot be rewritten here',
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
  if (c.blind) return BLIND_TEXT[c.blind]
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
  /** Vendor library files with the name and the place of the reference, whatever they hold. */
  let inLibrary: string[] = []
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
    if (good.length === 0 && !device) {
      inLibrary = prints
        .filter(
          ([c, fp]) =>
            fp &&
            Math.abs(fp[0] - ref.size) <= LIBRARY_PATH_BYTES &&
            env.isVendorFile(c) &&
            suffixLength(wanted, c) >= LIBRARY_PATH_LEVELS,
        )
        .map(([c]) => c)
      if (options.matchLibraryPath) {
        good = inLibrary
        sizeOnly = false
        libraryPath = true
      }
    }
  } else if (device) {
    const hashes = new Set(await Promise.all(candidates.map((c) => probe.contentHash(c))))
    if (hashes.size > 1) return choice('ambiguous', { candidates })
  }
  /** The one file among `files` to take: the longest matching path end, then the nearest. */
  const settle = async (
    files: readonly string[],
    how: Pick<Choice, 'verified' | 'vendorUpdate' | 'sizeOnly' | 'libraryPath'>,
  ): Promise<Choice> => {
    const scored = files.map((c) => [suffixLength(wanted, c), c] as const)
    const best = Math.max(...scored.map(([score]) => score))
    const top = scored.filter(([score]) => score === best).map(([, c]) => c)
    const flags = { suffix: best, ...how }
    if (top.length > 1) {
      const hashes = new Set(await Promise.all(top.map((c) => probe.audioHash(c))))
      if (hashes.size > 1) return choice('ambiguous', { candidates: top, ...flags })
    }
    const ranked = top
      .map((c) => ({ c, key: priority(c, projectRoot, env) }))
      .sort(
        (a, b) =>
          a.key[0] - b.key[0] || a.key[1] - b.key[1] || compareCodePoints(a.key[2], b.key[2]),
      )
    return choice('found', { path: (ranked[0] as { c: string }).c, ...flags })
  }
  if (good.length === 0) {
    // What the opt-in rule would take is said with the refusal. (Not where only confirmed
    // files count: the rule's match would be left out there all the same.)
    const offered =
      inLibrary.length > 0 && !options.matchLibraryPath && !options.certainOnly
        ? await settle(inLibrary, {
            verified: false,
            vendorUpdate: false,
            sizeOnly: false,
            libraryPath: true,
          })
        : undefined
    return choice('mismatch', {
      candidates,
      ...(offered?.status === 'found' ? { libraryFile: offered.path } : {}),
    })
  }
  const found = await settle(good, { verified, vendorUpdate, sizeOnly, libraryPath })
  if (found.status !== 'found') return found
  const { status: _status, candidates: _candidates, ...flags } = found
  if (options.certainOnly && !verified)
    return choice('mismatch', { ...flags, path: '', candidates: [found.path] })
  return found
}
