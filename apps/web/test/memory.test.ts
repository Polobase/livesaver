/**
 * The folders of a page across a reload, as far as a browser lets a page keep them: the lists
 * with what was typed and ticked always, a folder itself where the browser handed out a handle.
 * (The browser's database is a list in memory here; the browser tests use the real one.)
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { copyFixtures, memoryFolder, tempDir, uploadedFolder, writeFile } from '@livesaver/test-kit'
import { type FolderSource, folderFromHandle, localEngineWorker } from '@livesaver/web'
import { createPinia, setActivePinia } from 'pinia'
import type { ScanOptions } from '../src/engine/index.js'
import { BrowserEngine } from '../src/engine/index.js'
import type { FolderMemory, Remembered } from '../src/engine/memory.js'
import { useEngineStore } from '../src/stores/engine.js'
import { useLibraryStore } from '../src/stores/library.js'
import { useScanStore } from '../src/stores/scan.js'

let tmp: { path: string; cleanup: () => void }
let projects: string
let samples: string
/** What the browser keeps for the site: it outlives a page. */
let kept: Remembered[]
let memory: FolderMemory

beforeEach(() => {
  tmp = tempDir()
  ;({ projects, samples } = copyFixtures(tmp.path))
  kept = []
  let options: ScanOptions | undefined
  memory = {
    all: async () => [...kept],
    keep: async (folders) => {
      // As a browser's database does it: what cannot be copied is refused.
      kept = folders.map(({ handle, ...rest }) => ({
        ...structuredClone(rest),
        ...(handle ? { handle } : {}),
      }))
    },
    options: () => options,
    keepOptions: (now) => {
      options = structuredClone(now)
    },
  }
})
afterEach(() => tmp.cleanup())

/** The page as it is after a load: a new engine and new stores over the same memory. */
async function page() {
  setActivePinia(createPinia())
  const engines = useEngineStore()
  engines.use(new BrowserEngine({ spawn: () => localEngineWorker({ cores: 4 }), memory }))
  await engines.load()
  const library = useLibraryStore()
  if (engines.start) library.init(engines.start)
  // What the page may do in a folder behind a handle is asked when the lists are filled.
  await Promise.resolve()
  return { engines, library, scans: useScanStore() }
}

/** What the page has been told is the last thing it did: the memory is written by then. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

/** A folder as a drop hands it over where the browser also gives a handle for it. */
function dropped(dir: string): FolderSource {
  const { name, files } = uploadedFolder(dir)
  return {
    kind: 'listing',
    name,
    paths: files.map((file) => file.path),
    open: async (index) => files[index]?.file,
    kept: memoryFolder(dir),
  }
}

const rows = (
  folders: readonly { name: string; path: string; vendor: boolean; waits?: string }[],
) => folders.map(({ name, path, vendor, waits }) => [name, path, vendor, waits ?? 'there'])

describe('the folders of a page after a reload', () => {
  test('the lists are kept with what was typed and ticked; an uploaded folder is added again', async () => {
    const first = await page()
    first.library.addSources('projects', [uploadedFolder(projects)])
    first.library.addSources('search', [uploadedFolder(samples)])
    const sample = first.library.search[0]?.id as string
    first.library.update(sample, { path: '/Volumes/Samples', vendor: true })
    first.library.options = { packLimitMB: 20, matchLibraryPath: true }
    await settled()

    const again = await page()
    // A browser hands a page an uploaded folder for one visit: its row is there, its files not.
    expect(rows(again.library.projects)).toEqual([['projects', '', false, 'folder']])
    expect(rows(again.library.search)).toEqual([['samples', '/Volumes/Samples', true, 'folder']])
    expect([again.library.canScan, again.library.request.projects]).toEqual([false, []])
    // How a scan matches is kept with the folders.
    expect(again.library.options).toEqual({ packLimitMB: 20, matchLibraryPath: true })
    expect(again.library.wanted).toEqual({ libraries: true, live: true })

    // Added again, a folder takes the place it had, with its path and its tick.
    again.library.addSources('search', [uploadedFolder(samples)])
    again.library.addSources('projects', [uploadedFolder(projects)])
    expect(rows(again.library.search)).toEqual([['samples', '/Volumes/Samples', true, 'there']])
    expect(rows(again.library.projects)).toEqual([['projects', '', false, 'there']])
    expect(again.library.request.search.map((folder) => folder.path)).toEqual(['/Volumes/Samples'])
    expect(await again.scans.run()).toBe(true)
    expect(again.scans.scan?.samples.sets).toBe(3)

    // A folder that is removed is forgotten.
    again.library.remove('search', again.library.search[0]?.id as string)
    await settled()
    expect(rows((await page()).library.search)).toEqual([])
  })

  test('a folder behind a handle is read again, once the browser allows it', async () => {
    const folder = memoryFolder(projects)
    const first = await page()
    first.library.addSources('projects', [folderFromHandle(folder)])
    await settled()

    // The browser still lets the page in (the same visit, or "allow on every visit").
    const allowed = await page()
    expect(rows(allowed.library.projects)).toEqual([['projects', '', false, 'there']])
    expect(allowed.library.asleep).toEqual([])
    expect(await allowed.scans.run()).toBe(true)
    expect(allowed.scans.scan?.samples.sets).toBe(3)

    // A later visit: the browser wants to be asked, and its user says no, then yes.
    folder.permission = 'prompt'
    folder.answer = 'denied'
    const asked = await page()
    expect(rows(asked.library.projects)).toEqual([['projects', '', false, 'permission']])
    expect(asked.library.asleep.map((waiting) => waiting.name)).toEqual(['projects'])
    expect(asked.library.canScan).toBe(false)
    const id = asked.library.projects[0]?.id as string
    expect(await asked.library.allow(id)).toBe(false)
    expect(asked.library.projects[0]?.waits).toBe('permission')
    folder.answer = 'granted'
    expect(await asked.library.allow(id)).toBe(true)
    expect([asked.library.projects[0]?.waits, asked.library.asleep]).toEqual([undefined, []])
    expect(await asked.scans.run()).toBe(true)
    expect(asked.scans.scan?.samples.sets).toBe(3)
  })

  test('a dropped folder is kept by its handle only if that shows every file', async () => {
    // A name a handle hides: Finder shows the ":" as "/".
    const odd = join(tmp.path, 'Odd')
    writeFile(join(odd, 'Claps:Snares', 'clap.wav'), 'RIFF')
    writeFile(join(odd, 'Kick.wav'), 'RIFF')
    const first = await page()
    first.library.addSources('projects', [dropped(projects)])
    first.library.addSources('search', [dropped(samples), dropped(odd)])
    await settled()
    expect(kept.map((folder) => [folder.name, folder.handle !== undefined, folder.lost])).toEqual([
      ['projects', true, 0],
      ['samples', true, 0],
      ['Odd', true, 1],
    ])

    const again = await page()
    expect(rows(again.library.projects)).toEqual([['projects', '', false, 'there']])
    expect(
      again.library.search.map(({ name, waits, lost }) => [name, waits ?? 'there', lost ?? 0]),
    ).toEqual([
      ['samples', 'there', 0],
      // Read through the handle, one of its files would be missing: it is to be dropped again.
      ['Odd', 'folder', 1],
    ])
    expect(await again.scans.run()).toBe(true)
    // What the scan finds through the handles is what it found through the drop.
    expect(again.scans.scan?.samples.counts.found).toBe(1)

    // The folder that waits is still said to wait after the next reload, with the reason.
    again.library.update(again.library.search[0]?.id as string, { vendor: true })
    await settled()
    expect(
      (await page()).library.search.map(({ name, vendor, lost }) => [name, vendor, lost ?? 0]),
    ).toEqual([
      ['samples', true, 0],
      ['Odd', false, 1],
    ])
  })

  test('a page without a database for it remembers nothing, and works as before', async () => {
    setActivePinia(createPinia())
    const engines = useEngineStore()
    engines.use(new BrowserEngine({ spawn: () => localEngineWorker({ cores: 4 }) }))
    await engines.load()
    const library = useLibraryStore()
    if (engines.start) library.init(engines.start)
    library.addSources('projects', [uploadedFolder(projects)])
    library.update(library.projects[0]?.id as string, { path: '/Music/Projects' })
    expect(rows(library.projects)).toEqual([['projects', '/Music/Projects', false, 'there']])
    expect(kept).toEqual([])
  })
})
