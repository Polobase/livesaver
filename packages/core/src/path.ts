/**
 * POSIX path operations with Python's `posixpath` semantics (normpath, relpath, commonpath). Pure string
 * functions: no file system access, so they work in every runtime. Windows paths stored inside
 * Live files are split with `splitPath`, which accepts both separators.
 */

export const sep = '/'

export function isAbs(path: string): boolean {
  return path.startsWith('/')
}

/** `posixpath.join`: an absolute component restarts the path. */
export function join(first: string, ...rest: string[]): string {
  let path = first
  for (const part of rest) {
    if (part.startsWith('/')) path = part
    else if (path === '' || path.endsWith('/')) path += part
    else path += `/${part}`
  }
  return path
}

/** `posixpath.normpath`: lexical; keeps a leading `//` as POSIX allows. */
export function normpath(path: string): string {
  if (path === '') return '.'
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

/** `posixpath.dirname`. */
export function dirname(path: string): string {
  const i = path.lastIndexOf('/') + 1
  let head = path.slice(0, i)
  if (head && head !== '/'.repeat(head.length)) head = head.replace(/\/+$/, '')
  return head
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

/** `posixpath.relpath` for absolute paths (lexical, case-sensitive). */
export function relpath(path: string, start: string): string {
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

/** `os.path.commonpath` for absolute POSIX paths. */
export function commonpath(paths: readonly string[]): string {
  if (paths.length === 0) throw new Error('commonpath() of an empty list')
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
  return `/${first.slice(0, n).join('/')}`
}

/** Components of a macOS or Windows path, without empty and `.` parts. */
export function splitPath(path: string): string[] {
  return path.split(/[\\/]+/).filter((c) => c && c !== '.')
}

/** Windows path (drive letter or any backslash), which a Mac cannot open directly. */
export function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:|\\/.test(path)
}
