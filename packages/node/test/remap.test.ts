/** Live's remap table read without SQLite equals what SQLite reads (needs an installed Live). */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRemapTable } from '@livesaver/core'
import { findLiveInstalls, readRemapTable } from '../src/index.js'

const install = (await findLiveInstalls())[0]

;(install ? describe : describe.skip)("Live's remap table", () => {
  test('the file reader and SQLite agree on every entry', async () => {
    const appResources = install?.appResources as string
    const viaSqlite = await readRemapTable(appResources)
    const viaFile = parseRemapTable(
      new Uint8Array(readFileSync(join(appResources, 'Database', 'filerefmap.db'))),
    )
    expect(viaFile.mapping.size).toBeGreaterThan(1000)
    expect(viaFile.mapping.size).toBe(viaSqlite.mapping.size)
    expect([...viaFile.mapping]).toEqual([...viaSqlite.mapping])
    expect(new Map(viaFile.packNames)).toEqual(new Map(viaSqlite.packNames))
  })
})
