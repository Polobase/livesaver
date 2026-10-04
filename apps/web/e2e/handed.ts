/**
 * A project folder that a page may edit, for the browser tests. The folder dialog cannot be
 * driven by a test, and no test browser lets a page write to a folder of the disk without a
 * person saying yes: so the folder lies in the browser's own file system, behind the same
 * handles a folder of the disk has, and the test hands it out in place of the dialog.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { Page } from 'playwright'

/** Every file below a folder of the disk, by its path in it. */
export function filesIn(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesIn(join(dir, entry.name), base)
      : [relative(base, join(dir, entry.name))],
  )
}
export const sha1 = (data: Uint8Array) => createHash('sha1').update(data).digest('hex')
/** Backups are named by the second they were made in, and what an undo takes out by its time. */
export const unstamped = (path: string) =>
  path
    .replace(/\[\d{4}-\d\d-\d\d \d{6}\]/, '[when]')
    .replace(/^\.livesaver-trash\/[^/]+\//, '.livesaver-trash/[when]/')

/**
 * The folder the "dialog" hands out: `projects` in the browser's own file system. It is made
 * before the app starts, on every load, and takes the place of the folder dialog.
 */
export async function handOut(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const folder = async () => {
      const root = await navigator.storage.getDirectory()
      const disk = await root.getDirectoryHandle('disk', { create: true })
      return disk.getDirectoryHandle('projects', { create: true })
    }
    Object.assign(window, { showDirectoryPicker: folder, projectsFolder: folder })
  })
}

/** Puts files into the folder that is handed out. */
export async function fill(page: Page, dir: string): Promise<void> {
  const files = filesIn(dir).map((path) => ({
    path,
    data: readFileSync(join(dir, path)).toString('base64'),
  }))
  await page.evaluate(async (all) => {
    const top = await (
      window as unknown as { projectsFolder: () => Promise<FileSystemDirectoryHandle> }
    ).projectsFolder()
    for (const { path, data } of all) {
      const parts = path.split('/')
      const name = parts.pop() as string
      let folder = top
      for (const part of parts) folder = await folder.getDirectoryHandle(part, { create: true })
      const stream = await (await folder.getFileHandle(name, { create: true })).createWritable()
      await stream.write(Uint8Array.from(atob(data), (char) => char.charCodeAt(0)))
      await stream.close()
    }
  }, files)
}

/** What lies in the folder that is handed out: every file's checksum, and the sets themselves. */
export async function written(page: Page): Promise<Map<string, { sha1: string; data?: Buffer }>> {
  const files = await page.evaluate(async () => {
    const top = await (
      window as unknown as { projectsFolder: () => Promise<FileSystemDirectoryHandle> }
    ).projectsFolder()
    const out: { path: string; sha1: string; data: string }[] = []
    const walk = async (folder: FileSystemDirectoryHandle, prefix: string) => {
      for await (const entry of folder.values()) {
        if (entry.kind === 'directory') {
          await walk(entry as FileSystemDirectoryHandle, `${prefix}${entry.name}/`)
          continue
        }
        const bytes = new Uint8Array(
          await (await (entry as FileSystemFileHandle).getFile()).arrayBuffer(),
        )
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes))
        // A set comes along whatever its size, any other file if it is small. (In pieces: a
        // function takes only so many arguments.)
        let text = ''
        if (entry.name.endsWith('.als') || bytes.length < 200_000)
          for (let at = 0; at < bytes.length; at += 0x8000)
            text += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
        out.push({
          path: prefix + entry.name,
          sha1: [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
          data: btoa(text),
        })
      }
    }
    await walk(top, '')
    return out
  })
  return new Map(
    files.map(({ path, sha1: sum, data }) => [
      path,
      { sha1: sum, ...(data ? { data: Buffer.from(data, 'base64') } : {}) },
    ]),
  )
}

/** A set as its text. */
export const xml = (data: Buffer | undefined) =>
  new TextDecoder().decode(gunzipSync(data ?? Buffer.alloc(0)))
