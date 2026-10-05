/**
 * `node:path` as livesaver handles paths. The packages that run anywhere know one separator,
 * `/`, also for a path of Windows (`C:/Users/me`), which is how Live itself writes paths into a
 * set there. So what this host hands on is written that way: on Windows every `\` becomes a
 * `/` (Node's file functions take both there) and the drive letter is a capital. Elsewhere a
 * `\` is a sign of a file name like any other, and stays.
 */
import { homedir, tmpdir } from 'node:os'
import * as native from 'node:path'

/** A path as livesaver handles paths, from one as a system of `platform` writes it. */
export function slashedFor(platform: string, path: string): string {
  if (platform !== 'win32') return path
  return path.replaceAll('\\', '/').replace(/^[a-z]:/, (drive) => drive.toUpperCase())
}

/** A native path of this computer, as livesaver handles paths. */
export function slashed(path: string): string {
  return slashedFor(process.platform, path)
}

/** A path as Windows' own tools take it (`C:\Users\me`); elsewhere the path itself. */
export function nativePath(path: string): string {
  return process.platform === 'win32' ? path.replaceAll('/', '\\') : path
}

export function join(...parts: string[]): string {
  return slashed(native.join(...parts))
}

export function resolve(...parts: string[]): string {
  return slashed(native.resolve(...parts))
}

export function dirname(path: string): string {
  return slashed(native.dirname(path))
}

export function relative(from: string, to: string): string {
  return slashed(native.relative(from, to))
}

export function basename(path: string, suffix?: string): string {
  return native.basename(path, suffix)
}

export function extname(path: string): string {
  return native.extname(path)
}

export function isAbsolute(path: string): boolean {
  return native.isAbsolute(path)
}

/** The user's home folder. */
export function home(): string {
  return slashed(homedir())
}

/** The folder for temporary files. */
export function temp(): string {
  return slashed(tmpdir())
}

/** A folder Windows names in its environment (`ProgramData`, `APPDATA`), or `fallback`. */
export function windowsFolder(variable: string, fallback: string): string {
  const value = process.env[variable]
  return value ? slashedFor('win32', value) : fallback
}
