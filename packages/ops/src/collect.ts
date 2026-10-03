/**
 * Process sets: relink missing samples and Max devices, collect external ones into the project.
 * This module plans (and verifies) every change; writing files is delegated to a `Writer` so the
 * same code serves dry runs and `--apply`.
 */
import {
  amxdTypeCode,
  compareCodePoints,
  type FileRef,
  type LiveDoc,
  nfc,
  norm,
  patchNew,
  patchOld,
  posix,
  REL_DOCUMENT,
  REL_PACK,
  REL_PROJECT,
  type RelPathIds,
} from '@livesaver/core'
import { decodeUtf8, type Edit } from '@livesaver/xml'
import { type Environment, isInside } from './env.js'
import type { FileIndex } from './file-index.js'
import {
  type Choice,
  type ChooseOptions,
  type checkOf,
  choose,
  MISSING_STATES,
  type Status,
} from './match.js'
import type { Probe } from './probe.js'

export const PROJECT_MARKER = 'Ableton Project Info'
export const IMPORTED_DIR = 'Samples/Imported'
/** Where Live's "Collect All and Save" puts Max devices, by the type code in the .amxd header. */
export const MAX_DEVICE_DIRS: Readonly<Record<string, string>> = {
  aaaa: 'Presets/Audio Effects/Max Audio Effect/Imported',
  iiii: 'Presets/Instruments/Max Instrument/Imported',
  mmmm: 'Presets/MIDI Effects/Max MIDI Effect/Imported',
}
export const OTHER_DEVICE_DIR = 'Presets/Imported'

export interface CollectOptions extends ChooseOptions {
  /** Files from Ableton packs / the Core Library larger than this stay in the pack; 0 = never copy. */
  readonly packCopyLimit: number
}

export const DEFAULT_PACK_LIMIT = 50_000_000

/** Performs the file operations of a plan. The dry-run writer only counts. */
export interface Writer {
  readonly apply: boolean
  /** Copy a sample or device (and its .asd) into the project. */
  copy(source: string, destination: string): Promise<void>
  /** Back up and atomically replace a set; returns the backup's path. */
  writeSet(setPath: string, root: string, data: Uint8Array): Promise<string>
}

export const DRY_RUN: Writer = {
  apply: false,
  copy: async () => {},
  writeSet: async () => {
    throw new Error('dry run: nothing is written')
  },
}

export type Action = 'collected' | 'repaired' | 'path-updated'

export interface Change {
  readonly action: Action
  readonly name: string
  readonly oldPath: string
  /** Relative to the project root, absolute if it stays outside. */
  readonly newPath: string
  /** File copied into the project ('' = none). */
  readonly source: string
  /** How the file was found (`methodText`), for the reports. */
  readonly method: string
  readonly check: ReturnType<typeof checkOf> | 'existed-outside' | ''
  readonly suffix: number
  readonly keptInPack: '' | 'device' | 'large'
  /** false: content not confirmed by size + CRC. */
  readonly certain: boolean
}

export interface Missing {
  readonly ref: FileRef
  readonly choice: Choice
}

export interface SetResult {
  readonly setPath: string
  readonly projectRoot: string
  creator: string
  minorVersion: string
  readonly counts: Record<Status, number>
  readonly changes: Change[]
  readonly missing: Missing[]
  /** Existing sample files the set uses. */
  readonly files: string[]
  /** One entry per distinct reference (`FileRef.key`) with its outcome. */
  readonly decisions: Decision[]
  backup: string
  written: boolean
  error: string
  skipped: boolean
  /** The patched document (only kept when a caller asks for it). */
  newXml?: Uint8Array
  edits?: Edit[]
}

export interface Decision {
  readonly key: string
  readonly name: string
  readonly kind: FileRef['kind']
  readonly status: Status
  readonly destination: string
  readonly source: string
  readonly method: string
  readonly certain: boolean
  readonly stale: boolean
}

export function emptyCounts(): Record<Status, number> {
  return { ok: 0, kept: 0, external: 0, found: 0, 'not-found': 0, ambiguous: 0, mismatch: 0 }
}

export function isComplete(r: SetResult): boolean {
  return !r.error && !MISSING_STATES.some((s) => r.counts[s] > 0)
}

/** Nearest folder containing "Ableton Project Info" (else the set's folder). */
export async function projectRootOf(setPath: string, probe: Probe): Promise<string> {
  const folder = posix.dirname(posix.normpath(setPath))
  let current = folder
  for (;;) {
    if (await probe.isDir(posix.join(current, PROJECT_MARKER))) return current
    const parent = posix.dirname(current)
    if (parent === current) return folder
    current = parent
  }
}

/** All Live sets below the targets, without Backup folders and AppleDouble files (sorted walk). */
export async function findSets(
  targets: readonly string[],
  excludes: readonly string[],
  probe: Probe,
): Promise<string[]> {
  const found: string[] = []
  const walk = async (dir: string): Promise<void> => {
    const entries = (await probe.fs.listDir(dir)) ?? []
    const files = entries
      .filter((e) => !e.isDirectory)
      .map((e) => e.name)
      .sort(compareCodePoints)
    for (const name of files) {
      if (name.toLowerCase().endsWith('.als') && !name.startsWith('._'))
        found.push(posix.join(dir, name))
    }
    const dirs = entries
      .filter((e) => e.isDirectory && e.name !== 'Backup' && !e.name.startsWith('.'))
      .filter((e) => !excludes.some((x) => isInside(posix.join(dir, e.name), x)))
      .sort((a, b) => compareCodePoints(a.name, b.name))
    for (const d of dirs) if (!d.isSymlink) await walk(posix.join(dir, d.name))
  }
  for (const target of targets) {
    if (await probe.isFile(target)) found.push(posix.normpath(target))
    else if (await probe.isDir(target)) await walk(posix.normpath(target))
  }
  return found
}

/** One project folder: shared copies and replacement choices for all its sets. */
export class Project {
  readonly root: string
  readonly index: FileIndex
  readonly env: Environment
  readonly probe: Probe
  readonly options: CollectOptions
  readonly writer: Writer
  copiedFiles = 0
  copiedBytes = 0
  private readonly bySource = new Map<string, string>()
  private readonly claimed = new Map<string, string>()
  private readonly choices = new Map<string, Promise<Choice>>()

  constructor(
    root: string,
    index: FileIndex,
    env: Environment,
    probe: Probe,
    options: CollectOptions,
    writer: Writer,
  ) {
    this.root = root
    this.index = index
    this.env = env
    this.probe = probe
    this.options = options
    this.writer = writer
  }

  choose(ref: FileRef): Promise<Choice> {
    let c = this.choices.get(ref.key)
    if (!c) {
      c = choose(ref, this.index, this.root, this.env, this.probe, this.options)
      this.choices.set(ref.key, c)
    }
    return c
  }

  /** Destination of `source` in `folder` of the project (or at `wanted`); copies it when applying. */
  async place(source: string, wanted = '', folder = IMPORTED_DIR): Promise<string> {
    const key = norm(source)
    const known = this.bySource.get(key)
    if (known !== undefined) return known
    const name = nfc(posix.basename(source))
    const [stem, ext] = posix.splitext(name)
    const dir = posix.join(this.root, folder)
    const options = [...(wanted ? [wanted] : []), posix.join(dir, name)]
    for (let i = 2; i < 1000; i++) options.push(posix.join(dir, `${stem}-${i}${ext}`))
    let chosen: string | undefined
    for (const dst of options) {
      const claimedBy = this.claimed.get(norm(dst))
      if (claimedBy !== undefined) {
        if (await this.probe.sameContent(claimedBy, source)) {
          chosen = dst
          break
        }
        continue
      }
      if (await this.probe.exists(dst)) {
        if ((await this.probe.isFile(dst)) && (await this.probe.sameContent(dst, source))) {
          this.claimed.set(norm(dst), source)
          chosen = dst
          break
        }
        continue
      }
      this.claimed.set(norm(dst), source)
      await this.copy(source, dst)
      chosen = dst
      break
    }
    if (chosen === undefined) throw new Error(`no free file name for ${name}`)
    this.bySource.set(key, chosen)
    return chosen
  }

  private async copy(source: string, dst: string): Promise<void> {
    this.copiedFiles++
    this.copiedBytes += await this.probe.size(source)
    if (!this.writer.apply) return
    await this.writer.copy(source, dst)
    this.probe.forget(dst)
    this.probe.forget(`${dst}.asd`)
  }
}

/** For a missing project file (type 3): its original place, if still inside the project. */
export function wantedLocation(ref: FileRef, root: string): string {
  if (ref.relType !== REL_PROJECT || ref.relDirs.includes('..') || !ref.relPath) return ''
  const wanted = posix.normpath(posix.join(root, ref.relPath))
  return isInside(wanted, root) ? wanted : ''
}

export async function lastMod(dst: string, source: string, probe: Probe): Promise<number> {
  const s = (await probe.stat(dst)) ?? (await probe.stat(source))
  if (!s) throw new Error(`No such file or directory: '${source}'`)
  return s.mtimeSec
}

export async function keepInPack(
  path: string,
  env: Environment,
  probe: Probe,
  options: CollectOptions,
  device: boolean,
): Promise<boolean> {
  return env.isPackFile(path) && (device || (await probe.size(path)) > options.packCopyLimit)
}

/** Folder of the project that collected copies go to, as in Live's "Collect All and Save". */
export async function importDir(ref: FileRef, path: string, probe: Probe): Promise<string> {
  if (ref.kind !== 'device') return IMPORTED_DIR
  const code = amxdTypeCode(await probe.fs.read(path, 0, 12))
  return (code && MAX_DEVICE_DIRS[code]) || OTHER_DEVICE_DIR
}

export function shown(path: string, root: string): string {
  return isInside(path, root) ? posix.relpath(path, root) : path
}

/** New-format reference to a project file whose stored path is outdated. */
export function isStale(ref: FileRef, existing: string, root: string): boolean {
  if (ref.format !== 'new') return false
  const rel = posix.relpath(existing, root)
  return (
    ref.relType !== REL_PROJECT ||
    norm(ref.relPath) !== norm(rel) ||
    norm(ref.path) !== norm(existing)
  )
}

/** Edits that point `ref` at `dst`: relative to the project, the pack it lives in, or the set. */
export async function refEdits(
  doc: LiveDoc,
  ref: FileRef,
  dst: string,
  root: string,
  setDir: string,
  env: Environment,
  ids: RelPathIds,
  lastModDate: number | undefined,
): Promise<Edit[]> {
  const body = decodeUtf8(doc.xml, ref.bodySpan.start, ref.bodySpan.end)
  let relType = REL_DOCUMENT
  let base = setDir
  let pack: { name: string; id: string } | undefined
  if (isInside(dst, root)) {
    relType = REL_PROJECT
    base = root
  } else {
    const found = await env.packOf(dst)
    if (found) {
      relType = REL_PACK
      base = found.root
      pack = { name: found.name, id: found.id }
    }
  }
  const relParts = posix.relpath(dst, base).split('/').map(nfc)
  let newBody: string
  if (ref.format === 'new') {
    newBody = patchNew(body, relType, relParts.join('/'), nfc(dst), pack)
  } else {
    const absDirs = posix
      .dirname(dst)
      .split('/')
      .filter((p) => p)
      .map(nfc)
    newBody = patchOld(
      body,
      relType,
      relParts.slice(0, -1),
      relParts.at(-1) as string,
      absDirs,
      ids,
      pack,
    )
  }
  const edits: Edit[] = [{ start: ref.bodySpan.start, end: ref.bodySpan.end, text: newBody }]
  if (lastModDate !== undefined && ref.lastModSpan) {
    edits.push({
      start: ref.lastModSpan.start,
      end: ref.lastModSpan.end,
      text: String(lastModDate),
    })
  }
  return edits
}

export interface ProcessOptions {
  /** Keep the patched XML on the result (for writing, diffs and tests). */
  readonly keepXml?: boolean
  /**
   * In a dry run, only count the references of the patched XML instead of scanning it strictly
   * (the scan is most of a plan's time where no worker thread does it). A set is never written
   * without the strict scan.
   */
  readonly quickPlan?: boolean
}
