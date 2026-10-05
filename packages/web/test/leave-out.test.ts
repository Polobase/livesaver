/** Sets of an older Live are left out of a scan and of a fix in the page, when asked. */
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  copyFixtures,
  MemoryDirectory,
  makeProject,
  memoryFiles,
  memoryFolder,
  readSet,
  tempDir,
  uploadedFolder,
  writeSet,
} from '@livesaver/test-kit'
import {
  type FixEvent,
  type FixRequest,
  fixFolders,
  folderFromHandle,
  type ScanEvent,
  scanFolders,
} from '../src/index.js'

const OLD = 'Years Ago Project/Years Ago.als'
const SET = 'Brokenpath Project/Brokenpath.als'

let tmp: { path: string; cleanup: () => void }
let projects: string
let samples: string
let folder: MemoryDirectory

/** Beside the fixtures: an old save of the set that misses a sample, as Live 9 had saved it. */
beforeEach(() => {
  tmp = tempDir()
  ;({ projects, samples } = copyFixtures(tmp.path))
  const now = readSet(join(projects, SET))
  writeSet(
    join(makeProject(projects, 'Years Ago'), 'Years Ago.als'),
    now.replace(/Creator="Ableton Live [^"]*"/, 'Creator="Ableton Live 9.7.7"'),
  )
  folder = memoryFolder(projects)
})
afterEach(() => tmp.cleanup())

const request = (minLive?: number): FixRequest => ({
  projects: [{ id: 'p', source: folderFromHandle(folder), path: projects, vendor: false }],
  search: [{ id: 's', source: uploadedFolder(samples), path: samples, vendor: false }],
  options: { packLimitMB: 50, matchLibraryPath: false, ...(minLive ? { minLive } : {}) },
})

async function scan(minLive?: number) {
  const events: ScanEvent[] = []
  await scanFolders(request(minLive), (event) => events.push(event), { cores: 1 })
  const last = events.at(-1)
  if (last?.type !== 'scanned') throw new Error(JSON.stringify(last))
  return last.scan.samples
}

test('a scan leaves them out when asked: in no count and no row', async () => {
  const all = await scan()
  expect([all.sets, all.leftOut, all.changingSets]).toEqual([4, 0, 2])
  expect(all.setRows.map((row) => row.path)).toContain(OLD)

  const some = await scan(10)
  expect([some.sets, some.leftOut, some.changingSets]).toEqual([3, 1, 1])
  expect(some.setRows.map((row) => row.path)).not.toContain(OLD)
  expect(some.projectRows.map((row) => row.path)).not.toContain('Years Ago Project')
  // The fixtures' own sets are of Live 12: asked for 13, nothing is left to check.
  expect((await scan(13)).sets).toBe(0)
})

test('a fix leaves them as they are', async () => {
  const events: FixEvent[] = []
  await fixFolders(request(10), (event) => events.push(event), {
    cores: 1,
    state: async () => new MemoryDirectory(''),
  })
  const last = events.at(-1)
  if (last?.type !== 'fixed') throw new Error(JSON.stringify(last))
  expect([last.fixed.sets, last.fixed.errors]).toEqual([1, []])
  const files = memoryFiles(folder)
  expect([files.get(SET)?.writes, files.get(OLD)?.writes]).toEqual([1, 0])
  expect([...files.keys()].some((path) => path.startsWith('Years Ago Project/Samples'))).toBe(false)
})
