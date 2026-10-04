/** A scan in a worker: the page keeps the files, and hands over each one the engine asks for. */
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { copyFixtures, pickedFolder, tempDir, uploadedFolder } from '@livesaver/test-kit'
import {
  type EngineWorker,
  type FromEngine,
  localEngineWorker,
  type ScanEvent,
  type ScanRequest,
  scanInWorker,
  type ToEngine,
  wireFolder,
} from '../src/index.js'

let tmp: { path: string; cleanup: () => void }
let projects: string
let samples: string
beforeEach(() => {
  tmp = tempDir()
  ;({ projects, samples } = copyFixtures(tmp.path))
})
afterEach(() => tmp.cleanup())

/** The engine on this thread behind a worker's interface, with what the page sent noted. */
function fakeWorker(log: { toEngine: ToEngine[]; terminated: boolean }): EngineWorker {
  const worker = localEngineWorker({ cores: 4 })
  const { postMessage, terminate } = worker
  worker.postMessage = (message) => {
    log.toEngine.push(message)
    postMessage(message)
  }
  worker.terminate = () => {
    log.terminated = true
    terminate()
  }
  return worker
}

const request = (): ScanRequest => ({
  projects: [{ id: 'p', source: uploadedFolder(projects), path: '', vendor: false }],
  search: [{ id: 's', source: uploadedFolder(samples), path: '', vendor: false }],
  options: { packLimitMB: 50, matchLibraryPath: false },
})

test('an uploaded folder travels as the paths of its files; a handle travels as it is', () => {
  const upload = wireFolder(request().projects[0] as ScanRequest['projects'][number])
  expect(upload.source.kind).toBe('listing')
  expect(upload.source.kind === 'listing' && upload.source.paths).toContain(
    'Brokenpath Project/Brokenpath.als',
  )
  expect(Object.keys(upload.source)).toEqual(['kind', 'name', 'paths'])
  const handle = { id: 'h', source: pickedFolder(projects), path: '', vendor: false }
  expect(wireFolder(handle).source).toEqual(handle.source)
  // What its handle hides (of a folder that was dropped to be edited) travels as paths too:
  // a worker can be sent no function.
  const hidden = { paths: [' lead.wav'], open: async () => undefined }
  const dropped = wireFolder({ ...handle, source: { ...handle.source, hidden } }).source
  expect(dropped).toEqual({ ...handle.source, hidden: { paths: [' lead.wav'] } })
  expect(() => structuredClone(dropped.kind === 'handle' && dropped.hidden)).not.toThrow()
})

test('the scan runs in the worker with the files the page hands over, then the worker is given up', async () => {
  const log = { toEngine: [] as ToEngine[], terminated: false }
  const events: ScanEvent[] = []
  const running = scanInWorker(
    () => fakeWorker(log),
    request(),
    (event) => events.push(event),
  )
  const scan = await running.result
  expect([scan.samples.sets, scan.samples.changingSets, scan.plugins.counts.used]).toEqual([
    3, 1, 6,
  ])
  expect(events.at(-1)?.type).toBe('scanned')
  // Requests for files never reach the listener: they are the client's business.
  expect(events.some((event) => (event as FromEngine).type === 'open')).toBe(false)
  const handed = log.toEngine.filter((message) => message.type === 'file')
  expect(handed.length).toBeGreaterThan(3)
  expect(handed.every((message) => message.type === 'file' && message.file instanceof File)).toBe(
    true,
  )
  expect(log.terminated).toBe(true)
})

test('a scan that fails or is stopped rejects with what to show', async () => {
  const log = { toEngine: [] as ToEngine[], terminated: false }
  const none = { ...request(), projects: [] }
  const failing = scanInWorker(
    () => fakeWorker(log),
    none,
    () => {},
  )
  expect(failing.result).rejects.toThrow()
  await failing.result.catch(() => {})
  expect(log.terminated).toBe(true)

  const stopped = scanInWorker(
    () => fakeWorker({ toEngine: [], terminated: false }),
    request(),
    () => {},
  )
  stopped.stop()
  expect(stopped.result).rejects.toThrow('The scan was stopped.')
})
