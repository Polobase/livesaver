/**
 * The engines that write: livesaver on this computer, and the browser where its user switched
 * fixing on, over a project folder it was given for editing. One scenario for both; then what
 * a browser has to settle before it writes.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MemoryDirectory, memoryFiles, memoryFolder, uploadedFolder } from '@livesaver/test-kit'
import { folderFromHandle, localEngineWorker } from '@livesaver/web'
import { BrowserEngine, type Progress, RunFailed, Unsupported } from '../src/engine/index.js'
import { OPTIONS, SET, shown, useLibrary } from './engine-setup.js'

const lib = useLibrary()
const { computer, editing } = lib

/** The engines that write, and the set they write as it is where they write it. */
const WRITERS = [
  [
    'livesaver on this computer',
    () => ({
      ...computer(),
      read: () => new Uint8Array(readFileSync(join(lib.now.projects, SET))),
    }),
  ],
  [
    'the browser, in a folder it was given for editing',
    () => {
      const setup = editing()
      return { ...setup, read: () => memoryFiles(setup.folder).get(SET)?.data ?? new Uint8Array(0) }
    },
  ],
] as const

for (const [who, setup] of WRITERS) {
  describe(who, () => {
    test('fixes, with the uncertain matches or without, and takes it back', async () => {
      const { engine, request, read } = setup()
      const scan = await engine.scan(request)
      const before = read()
      const project = scan.samples.projectRows.find((row) => row.changingSets > 0)
      const progress: Progress[] = []
      const fixed = await engine.fix(
        { ...request, only: [project?.root as string], certainOnly: true },
        (event) => progress.push(event),
      )
      expect([fixed.sets, fixed.files, fixed.bytes, fixed.errors]).toEqual([1, 1, 2000324, []])
      expect(progress.some((event) => event.type === 'phase' && event.phase === 'fixing')).toBe(
        true,
      )
      expect(read()).not.toEqual(before)
      // What was scanned is no longer true, so it is not kept.
      expect((await engine.start()).last).toBeUndefined()

      const [run] = await engine.runs()
      expect(run).toMatchObject({ id: fixed.run, command: 'collect', state: 'applied', sets: 1 })
      expect(run?.record?.options).toMatchObject({ certainOnly: true })
      const detail = await engine.run(fixed.run)
      expect(detail.steps.map((step) => step.op)).toEqual(['copy', 'write-set'])
      expect(await engine.report(fixed.run, 'changes.csv')).toContain('1.wav')

      // (The folders the app has are handed along: a browser finds the run's folder among them.)
      const undone = await engine.undo(fixed.run, request)
      expect([undone.restored, undone.trashed, undone.problems]).toEqual([1, 2, []])
      expect(read()).toEqual(before)
      expect((await engine.runs())[0]).toMatchObject({ state: 'undone', canUndo: false })
      // A scan after the undo finds what the first one found.
      expect(shown(await engine.scan(request))).toEqual(shown(scan))
    })

    test('a fix that cannot run says why, and names no run when nothing was written', async () => {
      const { engine, request } = setup()
      const failed = await engine
        .fix({ ...request, only: [lib.now.tmp.path] })
        .catch((error: unknown) => error as RunFailed)
      expect(failed).toBeInstanceOf(RunFailed)
      expect((failed as RunFailed).message).toContain('is not in a project folder that was')
      expect((failed as RunFailed).run).toBe('')
      const gone = await engine.undo('no-such-run', request).catch((error: unknown) => error)
      expect(gone).toBeInstanceOf(RunFailed)
      expect((gone as RunFailed).message).toContain('not a run that changed anything')
    })
  })
}

describe('a browser that writes', () => {
  test('does so only once its user switched it on, and only with a storage of its own', async () => {
    let on = false
    const state = new MemoryDirectory('')
    const storage = async () => state
    const engine = new BrowserEngine({
      spawn: () => localEngineWorker({ cores: 4, state: storage }),
      state: storage,
      writing: () => on,
    })
    const request = {
      projects: [engine.add(folderFromHandle(memoryFolder(lib.now.projects)), 'projects')],
      search: [engine.add(uploadedFolder(lib.now.samples), 'search')],
      options: OPTIONS,
    }
    expect(engine.capabilities).toMatchObject({ fix: false, undo: false, history: false })
    expect(engine.fix(request)).rejects.toBeInstanceOf(Unsupported)
    expect(engine.undo('run', request)).rejects.toBeInstanceOf(Unsupported)
    expect(await engine.runs()).toEqual([])

    on = true
    expect(engine.capabilities).toMatchObject({ fix: true, undo: true, history: true })
    // What a page still cannot do: see what is installed, upgrade, or look at the computer.
    expect(engine.capabilities).toMatchObject({
      upgrade: false,
      installedPlugins: false,
      liveStatus: false,
      reveal: false,
      paths: false,
    })
    const fixed = await engine.fix(request)
    expect(fixed.sets).toBe(1)
    expect((await engine.runs()).map((run) => run.id)).toEqual([fixed.run])
    // Switched off again, its runs are no longer shown; they are kept all the same.
    on = false
    expect(await engine.runs()).toEqual([])
    on = true
    expect((await engine.runs()).length).toBe(1)

    // Without a storage of its own (a browser that has none), the switch does nothing.
    const reading = new BrowserEngine({
      spawn: () => localEngineWorker({ cores: 4 }),
      writing: () => true,
    })
    expect(reading.capabilities.fix).toBe(false)
  })

  test('fixes in a folder it may edit: not in one that was uploaded, and not before it was allowed', async () => {
    const { engine, request } = editing()
    // What the page may do in a folder behind a handle is not known until the browser is asked.
    const chosen = engine.add(folderFromHandle(memoryFolder(lib.now.projects)), 'projects')
    expect(chosen.access).toBe('ask')
    // (A folder in memory has no permission to ask for: it can be edited.)
    expect(await engine.access(chosen.id)).toBe('edit')

    const uploaded = engine.add(uploadedFolder(lib.now.projects), 'projects')
    expect(uploaded.access).toBe('read')
    expect(await engine.access(uploaded.id)).toBe('read')
    expect(await engine.allowEditing(uploaded.id)).toBe('read')
    expect(engine.fix({ ...request, projects: [uploaded] })).rejects.toThrow(
      'The project folder “projects” was added to be read only: add it again with “Add folder”, for editing.',
    )

    // A folder that was dropped: the browser lets the page read it, and asks before it may edit.
    const asked: string[] = []
    let granted = false
    const dropped = Object.assign(memoryFolder(lib.now.projects), {
      queryPermission: async () => (granted ? 'granted' : 'prompt'),
      requestPermission: async (how: { mode: string }) => {
        asked.push(how.mode)
        granted = true
        return 'granted'
      },
    })
    const folder = engine.add(folderFromHandle(dropped), 'projects')
    expect(await engine.access(folder.id)).toBe('ask')
    const refused = await engine.fix({ ...request, projects: [folder] }).catch((error) => error)
    expect(refused).toBeInstanceOf(RunFailed)
    expect((refused as Error).message).toBe(
      'This page may not edit the project folder “projects” yet: allow it first.',
    )
    expect(memoryFiles(dropped).get(SET)?.writes).toBe(0)
    expect(await engine.allowEditing(folder.id)).toBe('edit')
    expect(asked).toEqual(['readwrite'])
    expect((await engine.fix({ ...request, projects: [folder] })).sets).toBe(1)
    expect(memoryFiles(dropped).get(SET)?.writes).toBe(1)
  })

  test('takes a run back only with the folder it changed; one thing at a time', async () => {
    const { engine, request, folder } = editing()
    const before = memoryFiles(folder).get(SET)?.data
    const fixing = engine.fix(request)
    // Nothing else runs beside a fix.
    expect(engine.scan(request)).rejects.toThrow('A scan has to wait: the fix is still running.')
    expect(engine.undo('run', request)).rejects.toThrow(
      'The fix that was started is still running.',
    )
    expect((await engine.status()).busy).toBe('fix')
    const fixed = await fixing
    expect((await engine.status()).busy).toBe('')

    expect(engine.undo(fixed.run)).rejects.toThrow(
      'To take this run back, the page needs the project folder it changed',
    )
    // After a reload the page has its runs, and none of its folders.
    const reloaded = new BrowserEngine({
      spawn: () => localEngineWorker({ cores: 4 }),
      state: async () => new MemoryDirectory(''),
      writing: () => true,
    })
    expect(reloaded.undo(fixed.run, request)).rejects.toThrow(
      'The folder "projects" has to be added again.',
    )
    expect((await engine.undo(fixed.run, request)).restored).toBe(1)
    expect(memoryFiles(folder).get(SET)?.data).toEqual(before as Uint8Array)
  })
})
