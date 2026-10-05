/**
 * POSIX path operations with Python's `posixpath` semantics (normpath, relpath, commonpath). Pure string
 * functions: no file system access, so they work in every runtime.
 *
 * A path of Windows is written with `/` as well, as Live itself writes it into a set: its drive
 * is the first part, and a root of its own (`C:/Users/me`). A path that a set of Live 9 or 10
 * stores with `\` is brought to that form with `slashed`; `splitPath` accepts both separators.
 */

export const sep = '/'

/** The drive a path of Windows begins with (`C:` of `C:/Users`), or '' (POSIX, or relative). */
export function drive(path: string): string {
  return /^[A-Za-z]:(?=[\\/]|$)/.exec(path)?.[0] ?? ''
}

/** A path as livesaver handles paths: with `/` between its parts, whatever stored it. */
export function slashed(path: string): string {
  return path.includes('\\') ? path.replaceAll('\\', '/') : path
}

export function isAbs(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:\//.test(path)
}

/** `posixpath.join`: an absolute component restarts the path. */
export function join(first: string, ...rest: string[]): string {
  let path = first
  for (const part of rest) {
    if (isAbs(part)) path = part
    else if (path === '' || path.endsWith('/')) path += part
    else path += `/${part}`
  }
  return path
}

/**
 * `posixpath.normpath`: lexical; keeps a leading `//` as POSIX allows. A drive is a root of its
 * own, written with a capital letter: `c:/a/../..` is `C:/`.
 */
export function normpath(path: string): string {
  if (path === '') return '.'
  const letter = drive(path)
  if (letter) {
    const rest = normpath(`/${path.slice(letter.length).replace(/^\/+/, '')}`)
    return `${letter.toUpperCase()}${rest}`
  }
  let initialSlashes = path.startsWith('/') ? 1 : 0
  if (initialSlashes && path.startsWith('//') && !path.startsWith('///')) initialSlashes = 2
  const out: string[] = []
  for (const comp of path.split('/')) {
    if (comp === '' || comp === '.') continue
    if (
      comp !== '..' ||
      (!initialSlashes && out.length === 0) ||
      (out.length > 0 && out.at(-1) === '..')
    ) {
      out.push(comp)
    } else if (out.length > 0) {
      out.pop()
    }
  }
  const joined = '/'.repeat(initialSlashes) + out.join('/')
  return joined || '.'
}

/** `posixpath.dirname`. The folder of `C:/x` is the root of its drive, `C:/`. */
export function dirname(path: string): string {
  const i = path.lastIndexOf('/') + 1
  let head = path.slice(0, i)
  if (head && head !== '/'.repeat(head.length)) head = head.replace(/\/+$/, '')
  return /^[A-Za-z]:$/.test(head) ? `${head}/` : head
}

/** `posixpath.basename`. */
export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** `posixpath.splitext`: leading dots of the file name don't start an extension. */
export function splitext(path: string): [stem: string, ext: string] {
  const sepIndex = path.lastIndexOf('/')
  const dotIndex = path.lastIndexOf('.')
  if (dotIndex > sepIndex) {
    for (let i = sepIndex + 1; i < dotIndex; i++) {
      if (path[i] !== '.') return [path.slice(0, dotIndex), path.slice(dotIndex)]
    }
  }
  return [path, '']
}

/**
 * `posixpath.relpath` for absolute paths (lexical, case-sensitive). No way leads from one drive
 * to another, or from a drive to a POSIX path: the path itself is the answer then.
 */
export function relpath(path: string, start: string): string {
  if (drive(path).toUpperCase() !== drive(start).toUpperCase()) return normpath(path)
  const startList = normpath(start)
    .split('/')
    .filter((x) => x)
  const pathList = normpath(path)
    .split('/')
    .filter((x) => x)
  let i = 0
  while (i < startList.length && i < pathList.length && startList[i] === pathList[i]) i++
  const rel = [...Array<string>(startList.length - i).fill('..'), ...pathList.slice(i)]
  return rel.length === 0 ? '.' : rel.join('/')
}

/**
 * `os.path.commonpath` for absolute paths. Paths on different drives have nothing in common:
 * the answer is '' then.
 */
export function commonpath(paths: readonly string[]): string {
  if (paths.length === 0) throw new Error('commonpath() of an empty list')
  const drives = new Set(paths.map((p) => drive(p).toUpperCase()))
  if (drives.size > 1) return ''
  const letter = drives.values().next().value ?? ''
  const split = paths.map((p) =>
    normpath(p)
      .split('/')
      .filter((x) => x),
  )
  const first = split[0] as string[]
  let n = first.length
  for (const parts of split) {
    let k = 0
    while (k < n && k < parts.length && parts[k] === first[k]) k++
    n = k
  }
  // (Of a drive path the drive is the first part: `C:/Users`, and `C:/` for the drive alone.)
  if (letter) return n <= 1 ? `${letter}/` : first.slice(0, n).join('/')
  return `/${first.slice(0, n).join('/')}`
}

/** Components of a macOS or Windows path, without empty and `.` parts. */
export function splitPath(path: string): string[] {
  return path.split(/[\\/]+/).filter((c) => c && c !== '.')
}

/**
 * A path of Windows, by a drive letter or any backslash. On a Mac no such file can be opened;
 * on Windows it is a path like any other (see `slashed`).
 */
export function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:|\\/.test(path)
}
