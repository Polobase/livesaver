/**
 * Write port for Node/Bun on macOS (and other POSIX systems). Every operation either creates a new
 * file under a temporary name and links it into place, or replaces a set atomically after cloning
 * it (so Finder tags, comments, ACLs and mode survive). Nothing is ever overwritten or deleted.
 */
import { spawn } from 'node:child_process'
import { constants, existsSync } from 'node:fs'
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  statfs,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import type { FsWrite } from '@livesaver/core'

const bun = Boolean((globalThis as { Bun?: unknown }).Bun)
const darwin = process.platform === 'darwin'
/** Under Node, larger files are cloned with `cp -c` (libuv's copyfile never clones on macOS). */
const CLONE_WITH_CP_FROM = 8 * 1024 * 1024

function run(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} ${args.join(' ')}: ${stderr.trim() || `exit ${code}`}`)),
    )
  })
}

/** Copy file content to a path that does not exist yet (clone where the runtime can). */
async function copyData(source: string, target: string, size: number): Promise<void> {
  if (!bun && darwin && size >= CLONE_WITH_CP_FROM) {
    try {
      await run('/bin/cp', ['-c', source, target])
      return
    } catch {
      await rm(target, { force: true })
    }
  }
  // Bun clones on APFS here; COPYFILE_EXCL never overwrites.
  await copyFile(source, target, constants.COPYFILE_EXCL)
}

async function setTimes(path: string, atimeNs: bigint, mtimeNs: bigint): Promise<void> {
  await utimes(path, Number(atimeNs) / 1e9, Number(mtimeNs) / 1e9)
}

export interface NodeFsWriteOptions {
  /** Move "trashed" files into this folder instead of the user's Trash (tests). */
  readonly trashDir?: string
}

export class NodeFsWrite implements FsWrite {
  private readonly trashDir: string | undefined

  constructor(options: NodeFsWriteOptions = {}) {
    this.trashDir = options.trashDir
  }

  async mkdirp(path: string): Promise<void> {
    await mkdir(path, { recursive: true })
  }

  async copyFile(source: string, destination: string): Promise<void> {
    const s = await stat(source, { bigint: true })
    const dir = dirname(destination)
    await mkdir(dir, { recursive: true })
    if (existsSync(destination)) throw new Error(`refusing to overwrite ${destination}`)
    const partial = join(dir, `.${basename(destination)}.livesaver-partial`)
    await rm(partial, { force: true })
    try {
      await copyData(source, partial, Number(s.size))
      // Like shutil.copystat: mode and times; protected flags (system sounds) may refuse the mode.
      await chmod(partial, Number(s.mode) & 0o7777).catch(() => {})
      await setTimes(partial, s.atimeNs, s.mtimeNs)
      try {
        await link(partial, destination) // fails with EEXIST instead of overwriting
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'EEXIST' || existsSync(destination)) throw error
        await rename(partial, destination) // file systems without hard links (exFAT sticks)
      }
    } finally {
      await rm(partial, { force: true })
    }
  }

  async replaceFile(path: string, data: Uint8Array, modified?: bigint): Promise<void> {
    const target = await realpath(path) // write through symlinks instead of replacing them
    const before = await stat(target, { bigint: true })
    const tmp = join(dirname(target), `.${basename(target)}.livesaver-tmp`)
    await rm(tmp, { force: true })
    try {
      // A clone of the original carries its extended attributes (Finder tags/comments), ACL and mode.
      if (darwin) await run('/bin/cp', ['-p', target, tmp])
      else await copyFile(target, tmp, constants.COPYFILE_EXCL)
      const handle = await open(tmp, 'r+')
      try {
        await handle.truncate(0)
        await handle.write(data, 0, data.length, 0)
        await handle.sync()
      } finally {
        await handle.close()
      }
      // Written just now, the file says so; only an undo gives it the time of what it puts back.
      if (modified !== undefined) await setTimes(tmp, before.atimeNs, modified)
      await rename(tmp, target)
    } finally {
      await rm(tmp, { force: true })
    }
  }

  async writeNew(path: string, data: Uint8Array | string): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, data, { flag: 'wx' })
  }

  async appendDurable(path: string, line: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    const handle = await open(path, 'a')
    try {
      await handle.write(`${line}\n`)
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  async freeBytes(path: string): Promise<number | undefined> {
    let dir = path
    while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir)
    try {
      const s = await statfs(dir)
      return Number(s.bavail) * Number(s.bsize)
    } catch {
      return undefined
    }
  }

  async rename(from: string, to: string): Promise<void> {
    await mkdir(dirname(to), { recursive: true })
    const source = await lstat(from)
    if (source.isDirectory()) {
      // rename() replaces an empty folder: create `to` first (fails if it exists), so what gets
      // replaced can only be the folder made here.
      await mkdir(to)
      try {
        await rename(from, to)
      } catch (error) {
        await rmdir(to).catch(() => {})
        throw error
      }
      return
    }
    if (!source.isSymbolicLink()) {
      try {
        await link(from, to) // fails with EEXIST instead of replacing
        await unlink(from)
        return
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EMLINK') throw error
      }
    }
    if (existsSync(to)) throw Object.assign(new Error(`${to} exists`), { code: 'EEXIST' })
    await rename(from, to) // symlinks, file systems without hard links
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    const tmp = join(dirname(path), `.${basename(path)}.livesaver-tmp`)
    await rm(tmp, { force: true })
    try {
      const handle = await open(tmp, 'wx')
      try {
        await handle.writeFile(data)
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(tmp, path)
    } finally {
      await rm(tmp, { force: true })
    }
  }

  async trash(path: string): Promise<void> {
    if (!this.trashDir && darwin) {
      try {
        // Finder's delete keeps "Put Back" working.
        await run('/usr/bin/osascript', [
          '-e',
          `tell application "Finder" to delete (POSIX file ${JSON.stringify(path)})`,
        ])
        return
      } catch {}
    }
    const trashDir =
      this.trashDir ??
      (darwin ? join(homedir(), '.Trash') : join(homedir(), '.local', 'share', 'Trash', 'files'))
    await mkdir(trashDir, { recursive: true })
    const ext = extname(path)
    const stem = basename(path, ext)
    let target = join(trashDir, basename(path))
    for (let n = 2; existsSync(target); n++) target = join(trashDir, `${stem} ${n}${ext}`)
    await rename(path, target)
  }
}
