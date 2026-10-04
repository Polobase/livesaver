/**
 * Folders on disk as a browser would hand them to a page: through handles (File System Access
 * API) or as the files of a folder upload. The shapes match `FolderSource` of `@livesaver/web`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

export interface FakeDirectoryHandle {
  readonly kind: 'directory'
  readonly name: string
  values(): AsyncIterable<FakeDirectoryHandle | FakeFileHandle>
}

export interface FakeFileHandle {
  readonly kind: 'file'
  readonly name: string
  getFile(): Promise<File>
}

function fileOf(path: string, name: string): File {
  return new File([readFileSync(path)], name, { lastModified: statSync(path).mtimeMs })
}

function handleOf(dir: string, name: string): FakeDirectoryHandle {
  return {
    kind: 'directory',
    name,
    async *values() {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) yield handleOf(path, entry.name)
        else if (entry.isFile())
          yield { kind: 'file', name: entry.name, getFile: async () => fileOf(path, entry.name) }
      }
    },
  }
}

/** A directory as the folder picker of the File System Access API delivers it. */
export function pickedFolder(dir: string): {
  kind: 'handle'
  name: string
  handle: FakeDirectoryHandle
} {
  return { kind: 'handle', name: basename(dir), handle: handleOf(dir, basename(dir)) }
}

/** A directory as a folder upload (`webkitdirectory`) delivers it: every file, with its path. */
export function uploadedFolder(dir: string): {
  kind: 'files'
  name: string
  files: { path: string; file: File }[]
} {
  const files: { path: string; file: File }[] = []
  const walk = (current: string, prefix: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path, `${prefix}${entry.name}/`)
      else if (entry.isFile())
        files.push({ path: prefix + entry.name, file: fileOf(path, entry.name) })
    }
  }
  walk(dir, '')
  return { kind: 'files', name: basename(dir), files }
}

/**
 * A directory as a drop delivers it: its files by their paths, each fetched when it is read.
 * `kept`: the handle a browser also hands out for a dropped folder (Chromium).
 */
export function droppedFolder<H = never>(
  dir: string,
  kept?: H,
): {
  kind: 'listing'
  name: string
  paths: string[]
  open: (index: number) => Promise<File | undefined>
  kept?: H
} {
  const { name, files } = uploadedFolder(dir)
  return {
    kind: 'listing',
    name,
    paths: files.map((file) => file.path),
    open: async (index) => files[index]?.file,
    ...(kept ? { kept } : {}),
  }
}
