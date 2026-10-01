/**
 * Discover the local Ableton Live setup (macOS): installed apps, the User Library and pack locations
 * from Library.cfg, and Live's remap table for moved library files. See docs/format/live-setup.md.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { compareMinorVersion, EMPTY_REMAP, type RemapTable, remapKey } from '@livesaver/core'
import { decodeUtf8, scan } from '@livesaver/xml'
import { openReadonly } from './sqlite.js'

export interface LiveInstall {
  /** e.g. /Applications/Ableton Live 12 Suite.app */
  readonly app: string
  /** CFBundleShortVersionString without the build suffix, e.g. "12.4.6". */
  readonly version: string
  readonly appResources: string
  readonly coreLibrary: string
  readonly builtin: string
}

function versionParts(v: string): number[] {
  return v.split('.').map((x) => Number.parseInt(x, 10) || 0)
}

export function compareVersions(a: string, b: string): number {
  const pa = versionParts(a)
  const pb = versionParts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** Installed Live apps, newest version first. */
export async function findLiveInstalls(applications = '/Applications'): Promise<LiveInstall[]> {
  let names: string[]
  try {
    names = await readdir(applications)
  } catch {
    return []
  }
  const installs: LiveInstall[] = []
  for (const name of names) {
    if (!/^Ableton Live .*\.app$/.test(name)) continue
    const app = join(applications, name)
    const appResources = join(app, 'Contents', 'App-Resources')
    if (!existsSync(appResources)) continue
    let version = ''
    try {
      const plist = await readFile(join(app, 'Contents', 'Info.plist'), 'utf8')
      version =
        /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]*)<\/string>/.exec(plist)?.[1] ?? ''
    } catch {}
    version = version.split(' ')[0] ?? ''
    if (!version) version = /Live (\d+)/.exec(name)?.[1] ?? '0'
    installs.push({
      app,
      version,
      appResources,
      coreLibrary: join(appResources, 'Core Library'),
      builtin: join(appResources, 'Builtin'),
    })
  }
  return installs.sort((a, b) => compareVersions(b.version, a.version))
}

export interface PackSlice {
  readonly path: string
  readonly name: string
  readonly id: string
}

export interface LibraryConfig {
  /** Folder of the Library.cfg that was read. */
  readonly preferences: string
  readonly userLibrary: string | undefined
  readonly packs: readonly PackSlice[]
}

/** `~/Library/Preferences/Ableton/Live <version>/Library.cfg`, the newest one (or the one for `version`). */
export async function readLibraryConfig(version?: string): Promise<LibraryConfig | undefined> {
  const base = join(homedir(), 'Library', 'Preferences', 'Ableton')
  let dirs: string[]
  try {
    dirs = (await readdir(base)).filter((d) => /^Live \d/.test(d))
  } catch {
    return undefined
  }
  dirs.sort((a, b) => compareVersions(b.slice(5), a.slice(5)))
  const ordered = version ? [...dirs.filter((d) => d === `Live ${version}`), ...dirs] : dirs
  for (const dir of ordered) {
    const path = join(base, dir, 'Library.cfg')
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await readFile(path))
    } catch {
      continue
    }
    const ix = scan(bytes, { strict: false })
    const project = ix.firstDescendant(ix.root, 'UserLibrary')
    const lib = project === undefined ? undefined : ix.firstDescendant(project, 'LibraryProject')
    const projectPath = lib === undefined ? undefined : ix.value(lib, 'ProjectPath')
    const projectName = lib === undefined ? undefined : ix.value(lib, 'ProjectName')
    const packs = ix.all('LibrarySliceInfo').map((el) => ({
      path: ix.attr(el, 'Path') ?? '',
      name: ix.attr(el, 'DisplayName') ?? '',
      id: ix.attr(el, 'UniqueId') ?? '',
    }))
    return {
      preferences: join(base, dir),
      userLibrary: projectPath && projectName ? join(projectPath, projectName) : undefined,
      packs,
    }
  }
  return undefined
}

export async function readRemapTable(appResources: string): Promise<RemapTable> {
  const path = join(appResources, 'Database', 'filerefmap.db')
  if (!appResources || !existsSync(path)) return EMPTY_REMAP
  try {
    const db = await openReadonly(path)
    try {
      const mapping = new Map<string, readonly [number, string, string]>()
      for (const row of db.all(
        'SELECT src_type, src_packid, src_ref, dst_type, dst_packid, dst_ref FROM sample_mapping',
      )) {
        mapping.set(
          remapKey(Number(row.src_type), String(row.src_packid ?? ''), String(row.src_ref ?? '')),
          [Number(row.dst_type), String(row.dst_packid ?? ''), String(row.dst_ref ?? '')],
        )
      }
      const packNames = new Map<string, string>()
      for (const row of db.all('SELECT packid, packname FROM pack_names')) {
        packNames.set(String(row.packid), String(row.packname))
      }
      return { mapping, packNames }
    } finally {
      db.close()
    }
  } catch {
    return EMPTY_REMAP
  }
}

/** Whether Ableton Live is running (never write sets while it might have them open). */
export function liveIsRunning(): boolean {
  if (process.platform !== 'darwin') return false
  return spawnSync('pgrep', ['-x', 'Live']).status === 0
}

/** Decode a small text file leniently (Properties.cfg has a binary prefix). */
export async function readTextLenient(path: string): Promise<string | undefined> {
  try {
    return decodeUtf8(new Uint8Array(await readFile(path)))
  } catch {
    return undefined
  }
}

export { compareMinorVersion }
