/** The catalog: incremental indexing, the find language, re-checking unchanged sets. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { rmSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { EMPTY_REMAP } from '@livesaver/core'
import { createNodeHost, openDatabase } from '@livesaver/node'
import type { EnvConfig } from '@livesaver/ops'
import { type InstalledPlugin, Inventory } from '@livesaver/plugins'
import {
  arranged,
  clipsTrack,
  liveSet,
  makeProject,
  midiClip,
  midiTrack,
  SERUM,
  sampleClip,
  tempDir,
  writeFile,
  writeSet,
} from '@livesaver/test-kit'
import {
  Catalog,
  compileQuery,
  indexSets,
  parseDate,
  parseDuration,
  QueryError,
  searchCatalog,
  tokenize,
} from '../src/index.js'

const ENV: EnvConfig = {
  userLibrary: '',
  factoryPacks: '',
  appResources: '',
  preferredRoots: [],
  vendorLibraries: [],
  remap: EMPTY_REMAP,
}
const serum: InstalledPlugin = {
  format: 'VST2',
  ident: '1483109208',
  name: 'Serum',
  path: '/Plug-Ins/Serum.vst',
  native: false,
  scanned: true,
}

describe('the find language', () => {
  test('tokens keep quotes and negation', () => {
    expect(tokenize('plugin:serum "night drive" -stage:empty name:"Pro Q"')).toEqual([
      'plugin:serum',
      '"night drive"',
      '-stage:empty',
      'name:"Pro Q"',
    ])
  })

  test('durations, dates and errors', () => {
    expect([
      parseDuration('3:12'),
      parseDuration('1:02:03'),
      parseDuration('4m'),
      parseDuration('90'),
    ]).toEqual([192, 3723, 240, 90])
    const [from, to] = parseDate('2024-05')
    expect(new Date(from * 1000).getMonth()).toBe(4)
    expect(new Date(to * 1000).getMonth()).toBe(5)
    expect(() => compileQuery('bpm:fast')).toThrow(QueryError)
    expect(() => compileQuery('colour:red')).toThrow('unknown field')
    expect(compileQuery('').where).toBe('1')
  })

  test('terms compile to parameterized SQL', () => {
    const q = compileQuery('plugin:serum bpm:120..128 -stage:empty kick')
    expect(q.where).toContain('NOT (s.stage = ?)')
    expect(q.params).toEqual(['%serum%', 'serum', 120, 128, 'empty', '"kick"*'])
  })
})

describe('indexing and searching', () => {
  let tmp: { path: string; cleanup: () => void }
  let catalog: Catalog
  let song: string
  let loop: string
  const inventory = new Inventory([serum])
  const index = (full = false) =>
    indexSets(createNodeHost(), catalog, { targets: [tmp.path], env: ENV, inventory, full })

  beforeEach(async () => {
    tmp = tempDir()
    catalog = new Catalog(await openDatabase(':memory:'))
    const kick = writeFile(join(tmp.path, 'Samples', 'Kick.wav'), 'RIFF kick')
    const songRoot = makeProject(tmp.path, 'Night Drive')
    song = join(songRoot, 'Night Drive 5.als')
    writeSet(
      song,
      liveSet(
        arranged(12, 8, 10) + clipsTrack([sampleClip(kick), sampleClip('Samples/Snare.wav')]),
        {
          plugins: SERUM,
          tempo: 123,
        },
      ),
    )
    const loopRoot = makeProject(tmp.path, 'Loop')
    loop = join(loopRoot, 'Loop.als')
    writeSet(loop, liveSet(midiTrack({ session: [midiClip(0, 4)] }), { tempo: 90 }))
  })
  afterEach(() => {
    catalog.db.close()
    tmp.cleanup()
  })

  const names = (q: string) => searchCatalog(catalog, q).map((s) => s.name)

  test('index once, then only changed sets are read', async () => {
    expect(await index()).toMatchObject({ sets: 2, read: 2, unchanged: 0, removed: 0 })
    expect(catalog.stats()).toMatchObject({ sets: 2, projects: 2, plugins: 1, samples: 2 })
    expect(await index()).toMatchObject({ read: 0, unchanged: 2 })
    utimesSync(loop, new Date(), new Date(Date.now() + 5000))
    expect(await index()).toMatchObject({ read: 1, unchanged: 1 })
    expect(await index(true)).toMatchObject({ read: 2 })
  })

  test('the find language on indexed sets', async () => {
    await index()
    expect(names('plugin:serum')).toEqual(['Night Drive 5'])
    expect(names('bpm:120..128')).toEqual(['Night Drive 5'])
    expect(names('bpm:90')).toEqual(['Loop'])
    expect(names('stage:elaborated')).toEqual(['Night Drive 5'])
    expect(names('stage:session-only')).toEqual(['Loop'])
    expect(names('missing:samples')).toEqual(['Night Drive 5'])
    expect(names('rosetta:yes')).toEqual(['Night Drive 5'])
    expect(names('complete:yes')).toEqual(['Loop'])
    expect(names('sample:snare')).toEqual(['Night Drive 5'])
    expect(names('"night dri"')).toEqual(['Night Drive 5'])
    expect(names('drive -plugin:serum')).toEqual([])
    expect(names('length:>3:00')).toEqual(['Night Drive 5'])
    expect(names('has:session')).toEqual(['Loop'])
    expect(names('format:vst2 live:12')).toEqual(['Night Drive 5'])
  })

  test('re-checking finds samples that appeared and sets that were deleted', async () => {
    await index()
    expect(names('missing:samples')).toEqual(['Night Drive 5'])
    // the missing snare appears where the set looks for it (relative to its project)
    writeFile(join(tmp.path, 'Night Drive Project', 'Samples', 'Snare.wav'), 'RIFF snare')
    expect(await index()).toMatchObject({ read: 0, unchanged: 2 })
    expect(names('missing:samples')).toEqual([])
    expect(names('complete:no')).toEqual(['Night Drive 5']) // Serum still needs Rosetta
    rmSync(loop)
    const r = await index()
    expect(r.removed).toBe(1)
    expect(names('')).toEqual(['Night Drive 5'])
  })
})
