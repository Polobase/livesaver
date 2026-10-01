import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, symlinkSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir, writeFile } from '@livesaver/test-kit'
import { NodeFsWrite } from '../src/index.js'

const fsw = new NodeFsWrite()
const mac = process.platform === 'darwin'
const TAGS = 'com.apple.metadata:_kMDItemUserTags'

let tmp: { path: string; cleanup: () => void }
beforeEach(() => {
  tmp = tempDir()
})
afterEach(() => tmp.cleanup())

const mtimeUs = (p: string) => Math.round(Number(statSync(p, { bigint: true }).mtimeNs) / 1000)

describe('copyFile', () => {
  test('copies content and keeps the modification time', async () => {
    const src = writeFile(join(tmp.path, 'a', 'Kick.wav'), 'RIFF kick')
    utimesSync(src, 1_500_000_000.25, 1_500_000_000.123456)
    const dst = join(tmp.path, 'b', 'Samples', 'Imported', 'Kick.wav')
    await fsw.copyFile(src, dst)
    expect(readFileSync(dst, 'utf8')).toBe('RIFF kick')
    expect(Math.abs(mtimeUs(dst) - mtimeUs(src))).toBeLessThanOrEqual(1)
    expect(readdirSync(join(tmp.path, 'b', 'Samples', 'Imported'))).toEqual(['Kick.wav'])
  })

  test('never overwrites', async () => {
    const src = writeFile(join(tmp.path, 'a.wav'), 'new')
    const dst = writeFile(join(tmp.path, 'b.wav'), 'old')
    await expect(fsw.copyFile(src, dst)).rejects.toThrow()
    expect(readFileSync(dst, 'utf8')).toBe('old')
    expect(readdirSync(tmp.path).sort()).toEqual(['a.wav', 'b.wav'])
  })

  test('copies a large file (clone path under Node) intact', async () => {
    const big = new Uint8Array(9 * 1024 * 1024)
    for (let i = 0; i < big.length; i += 4096) big[i] = i % 251
    const src = writeFile(join(tmp.path, 'big.wav'), big)
    const dst = join(tmp.path, 'copy', 'big.wav')
    await fsw.copyFile(src, dst)
    expect(new Uint8Array(readFileSync(dst))).toEqual(big)
  })
})

describe('replaceFile', () => {
  ;(mac ? test : test.skip)('keeps Finder tags, times and mode; leaves no temp file', async () => {
    const set = writeFile(join(tmp.path, 'Song.als'), 'old set')
    utimesSync(set, 1_600_000_000, 1_600_000_000.5)
    expect(spawnSync('xattr', ['-w', TAGS, 'tagged', set]).status).toBe(0)
    const before = mtimeUs(set)
    await fsw.replaceFile(set, new TextEncoder().encode('new set, longer than before'))
    expect(readFileSync(set, 'utf8')).toBe('new set, longer than before')
    expect(spawnSync('xattr', ['-p', TAGS, set], { encoding: 'utf8' }).stdout.trim()).toBe('tagged')
    expect(Math.abs(mtimeUs(set) - before)).toBeLessThanOrEqual(1)
    expect(readdirSync(tmp.path)).toEqual(['Song.als'])
  })

  test('writes through a symlink instead of replacing it', async () => {
    const real = writeFile(join(tmp.path, 'real', 'Song.als'), 'old')
    const linkPath = join(tmp.path, 'Link.als')
    symlinkSync(real, linkPath)
    await fsw.replaceFile(linkPath, new TextEncoder().encode('new'))
    expect(readFileSync(real, 'utf8')).toBe('new')
    expect(spawnSync('test', ['-L', linkPath]).status).toBe(0)
  })
})

describe('journal and new files', () => {
  test('appendDurable appends lines; writeNew refuses to overwrite', async () => {
    const journal = join(tmp.path, 'runs', 'r1', 'journal.jsonl')
    await fsw.appendDurable(journal, '{"a":1}')
    await fsw.appendDurable(journal, '{"b":2}')
    expect(readFileSync(journal, 'utf8')).toBe('{"a":1}\n{"b":2}\n')
    await fsw.writeNew(join(tmp.path, 'x.txt'), 'one')
    await expect(fsw.writeNew(join(tmp.path, 'x.txt'), 'two')).rejects.toThrow()
    expect(readFileSync(join(tmp.path, 'x.txt'), 'utf8')).toBe('one')
  })

  test('freeBytes reports the volume', async () => {
    expect((await fsw.freeBytes(join(tmp.path, 'not', 'yet'))) ?? 0).toBeGreaterThan(0)
    expect(existsSync(join(tmp.path, 'not'))).toBe(false)
  })
})
