/** A doctor run over the browser host gives what the Node host gives. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { EMPTY_REMAP, type ParsedSet } from '@livesaver/core'
import { createNodeHost } from '@livesaver/node'
import { type DoctorResult, doctor, type EnvConfig, summary } from '@livesaver/ops'
import {
  copyFixtures,
  pickedFolder as picked,
  tempDir,
  uploadedFolder as uploaded,
} from '@livesaver/test-kit'
import {
  createWebHost,
  createWorkerParser,
  type FolderSource,
  type ParseScope,
  type ParseWorker,
  serveParser,
} from '../src/index.js'

const ENV: EnvConfig = {
  userLibrary: '',
  factoryPacks: '',
  appResources: '',
  preferredRoots: [],
  vendorLibraries: [],
  remap: EMPTY_REMAP,
}

let tmp: { path: string; cleanup: () => void }
let projects: string
let samples: string
beforeEach(() => {
  tmp = tempDir()
  ;({ projects, samples } = copyFixtures(tmp.path))
})
afterEach(() => tmp.cleanup())

const facts = (r: DoctorResult) =>
  r.results.map((s) => ({
    set: s.setPath,
    project: s.projectRoot,
    creator: s.creator,
    error: s.error,
    counts: s.counts,
    changes: s.changes,
    missing: s.missing.map((m) => [m.ref.key, m.choice.status, [...m.choice.candidates].sort()]),
    files: [...s.files].sort(),
  }))

/** A worker on this thread: what `serveParser` gets and sends, without a second thread. */
function loopback(): ParseWorker {
  const worker: ParseWorker = { onmessage: null, onerror: null, postMessage() {}, terminate() {} }
  const scope: ParseScope = {
    onmessage: null,
    postMessage: (data) => void worker.onmessage?.({ data } as MessageEvent),
  }
  serveParser(scope)
  worker.postMessage = (data) => void scope.onmessage?.({ data } as MessageEvent)
  return worker
}

describe('doctor in the browser', () => {
  const options = () => ({ targets: [projects], searchRoots: [projects, samples], env: ENV })
  const kinds: [string, (dir: string) => FolderSource][] = [
    ['picked folders', picked],
    ['uploaded folders', uploaded],
  ]

  for (const [title, source] of kinds) {
    test(`${title}: same result as on disk`, async () => {
      const onDisk = await doctor(createNodeHost(), options())
      const host = createWebHost([
        { path: projects, source: source(projects) },
        { path: samples, source: source(samples) },
      ])
      const inBrowser = await doctor(host, options())
      expect(facts(inBrowser)).toEqual(facts(onDisk))
      expect(summary(inBrowser.results, inBrowser.projects, false)).toBe(
        summary(onDisk.results, onDisk.projects, false),
      )
      expect(inBrowser.results.map((r) => r.changes.length)).toEqual([1, 0, 0])
    })
  }

  test('sets parsed by workers give the same result', async () => {
    const host = createWebHost([
      { path: projects, source: picked(projects) },
      { path: samples, source: uploaded(samples) },
    ])
    const plain = await doctor(host, options())
    const parser = createWorkerParser({ host, spawn: loopback, workers: 2 })
    const pooled = await doctor(host, { ...options(), parser })
    await parser.close()
    expect(facts(pooled)).toEqual(facts(plain))
  })

  test('a missing or broken set is reported, and a crashed worker loses nothing', async () => {
    const host = createWebHost([{ path: projects, source: picked(projects) }])
    const parser = createWorkerParser({ host, spawn: loopback, workers: 1 })
    const missing = await parser.parse(`${projects}/Nothing.als`)
    expect(missing).toEqual({
      ok: false,
      error: `unreadable: No such file or directory: '${projects}/Nothing.als'`,
    })

    const dead: ParseWorker = { onmessage: null, onerror: null, postMessage() {}, terminate() {} }
    const crashing = createWorkerParser({ host, spawn: () => dead, workers: 1 })
    const set = `${projects}/Brokenpath Project/Brokenpath.als`
    const waiting: Promise<ParsedSet> = crashing.parse(set)
    await new Promise((done) => setTimeout(done, 10))
    dead.onerror?.(new Error('worker died'))
    expect((await waiting).ok).toBe(true)
    expect((await crashing.parse(set)).ok).toBe(true) // from now on parsed on this thread
  })
})
