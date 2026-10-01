/**
 * Extended attributes on macOS (Finder tags live in one). Under Bun, libc's getxattr/setxattr/
 * removexattr are called directly through `bun:ffi`; under Node, which has no xattr API, the system's
 * `/usr/bin/xattr` tool is used (one process per call, fine for a fallback).
 */
import { execFile } from 'node:child_process'
import type { XattrPort } from '@livesaver/core'

const ENOATTR = 93 // macOS: attribute not found
const ERANGE = 34
const ERRNO_CODES: Record<number, string> = {
  1: 'EPERM',
  2: 'ENOENT',
  13: 'EACCES',
  20: 'ENOTDIR',
  30: 'EROFS',
  45: 'ENOTSUP',
  63: 'ENAMETOOLONG',
}

function errnoError(errno: number, op: string, path: string): Error {
  const code = ERRNO_CODES[errno] ?? `E${errno}`
  return Object.assign(new Error(`${code}: ${op} failed for ${path}`), { code, errno, path })
}

interface Libc {
  getxattr(
    path: Uint8Array,
    name: Uint8Array,
    value: Uint8Array | null,
    size: number,
    position: number,
    options: number,
  ): number | bigint
  setxattr(
    path: Uint8Array,
    name: Uint8Array,
    value: Uint8Array,
    size: number,
    position: number,
    options: number,
  ): number
  removexattr(path: Uint8Array, name: Uint8Array, options: number): number
  errno(): number
}

async function loadLibc(): Promise<Libc | undefined> {
  if (!(globalThis as { Bun?: unknown }).Bun || process.platform !== 'darwin') return undefined
  try {
    const specifier = 'bun:ffi'
    const ffi = (await import(specifier)) as {
      dlopen(
        path: string,
        symbols: Record<string, { args: string[]; returns: string }>,
      ): {
        symbols: Record<string, (...args: unknown[]) => unknown>
      }
      read: { i32(ptr: unknown, offset: number): number }
    }
    const lib = ffi.dlopen('/usr/lib/libSystem.B.dylib', {
      getxattr: { args: ['ptr', 'ptr', 'ptr', 'u64', 'u32', 'i32'], returns: 'i64' },
      setxattr: { args: ['ptr', 'ptr', 'ptr', 'u64', 'u32', 'i32'], returns: 'i32' },
      removexattr: { args: ['ptr', 'ptr', 'i32'], returns: 'i32' },
      __error: { args: [], returns: 'ptr' },
    })
    const s = lib.symbols as unknown as {
      getxattr: Libc['getxattr']
      setxattr: Libc['setxattr']
      removexattr: Libc['removexattr']
      __error(): unknown
    }
    return {
      getxattr: s.getxattr,
      setxattr: s.setxattr,
      removexattr: s.removexattr,
      errno: () => ffi.read.i32(s.__error(), 0),
    }
  } catch {
    return undefined
  }
}

const encoder = new TextEncoder()
const cstr = (s: string) => encoder.encode(`${s}\0`)

function ffiXattr(libc: Libc): XattrPort {
  return {
    async get(path, name) {
      const p = cstr(path)
      const n = cstr(name)
      for (;;) {
        const size = Number(libc.getxattr(p, n, null, 0, 0, 0))
        if (size < 0) {
          const errno = libc.errno()
          if (errno === ENOATTR) return undefined
          throw errnoError(errno, 'getxattr', path)
        }
        if (size === 0) return new Uint8Array(0)
        const buffer = new Uint8Array(size)
        const got = Number(libc.getxattr(p, n, buffer, size, 0, 0))
        if (got >= 0) return buffer.subarray(0, got)
        const errno = libc.errno()
        if (errno === ENOATTR) return undefined
        if (errno !== ERANGE) throw errnoError(errno, 'getxattr', path) // grew meanwhile: again
      }
    },
    async set(path, name, value) {
      const data = value.length ? value : new Uint8Array(1)
      if (libc.setxattr(cstr(path), cstr(name), data, value.length, 0, 0) !== 0)
        throw errnoError(libc.errno(), 'setxattr', path)
    },
    async remove(path, name) {
      if (libc.removexattr(cstr(path), cstr(name), 0) !== 0) {
        const errno = libc.errno()
        if (errno !== ENOATTR) throw errnoError(errno, 'removexattr', path)
      }
    },
  }
}

function xattrTool(
  args: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('/usr/bin/xattr', args, { maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0
      resolve({ code, stdout, stderr })
    })
  })
}

const hex = (data: Uint8Array) => Array.from(data, (b) => b.toString(16).padStart(2, '0')).join('')

function cliXattr(): XattrPort {
  return {
    async get(path, name) {
      const r = await xattrTool(['-px', name, path])
      if (r.code !== 0) {
        if (r.stderr.includes('No such xattr')) return undefined
        throw new Error(`xattr: ${r.stderr.trim() || `exit ${r.code}`}`)
      }
      const digits = r.stdout.replace(/\s+/g, '')
      const out = new Uint8Array(digits.length / 2)
      for (let i = 0; i < out.length; i++)
        out[i] = Number.parseInt(digits.slice(i * 2, i * 2 + 2), 16)
      return out
    },
    async set(path, name, value) {
      const r = await xattrTool(['-wx', name, hex(value), path])
      if (r.code !== 0) throw new Error(`xattr: ${r.stderr.trim() || `exit ${r.code}`}`)
    },
    async remove(path, name) {
      const r = await xattrTool(['-d', name, path])
      if (r.code !== 0 && !r.stderr.includes('No such xattr'))
        throw new Error(`xattr: ${r.stderr.trim() || `exit ${r.code}`}`)
    },
  }
}

/** Extended attributes for this runtime (macOS only; `undefined` elsewhere). */
export function createXattr(): XattrPort | undefined {
  if (process.platform !== 'darwin') return undefined
  let impl: Promise<XattrPort> | undefined
  const get = () => {
    impl ??= loadLibc().then((libc) => (libc ? ffiXattr(libc) : cliXattr()))
    return impl
  }
  return {
    get: async (path, name) => (await get()).get(path, name),
    set: async (path, name, value) => (await get()).set(path, name, value),
    remove: async (path, name) => (await get()).remove(path, name),
  }
}
