/**
 * The history for the web app: every run with what it did (like `livesaver runs`), its steps and
 * its report files; and showing a file in the system's file manager.
 */
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { createNodeHost } from '@livesaver/node'
import { readJournal, runSteps, runSummary } from '@livesaver/ops'
import { listRuns, readRun, runsDir } from '../state.js'
import type { WebSettings } from './local.js'
import type { WebRun, WebRunDetail } from './protocol.js'

/** What livesaver keeps in a run folder for itself; everything else in it is a report. */
const OWN_FILES = new Set(['journal.jsonl', 'run.json'])

/** A run's name is a folder name of livesaver's own making: nothing that leads elsewhere. */
function runFolder(id: string): string {
  const dir = join(runsDir(), id)
  if (!/^\w[\w.-]*$/.test(id) || !existsSync(dir)) throw new Error(`There is no such run: ${id}`)
  return dir
}

function reportsIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !OWN_FILES.has(entry.name) && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort()
}

async function summary(id: string): Promise<{ run: WebRun; entries: ReturnType<typeof runSteps> }> {
  const dir = runFolder(id)
  const entries = await readJournal(createNodeHost(), { id, dir })
  return {
    run: { ...runSummary(id, entries, readRun(id)), reports: reportsIn(dir) },
    entries: runSteps(entries),
  }
}

/** Every run, the newest first. */
export async function webRuns(): Promise<WebRun[]> {
  const runs: WebRun[] = []
  for (const id of listRuns().reverse()) runs.push((await summary(id)).run)
  return runs
}

export async function webRun(id: string): Promise<WebRunDetail> {
  const { run, entries } = await summary(id)
  return { run, steps: entries }
}

/** A report file of a run, as text. */
export function webReport(id: string, name: string): string {
  const dir = runFolder(id)
  if (!reportsIn(dir).includes(name)) throw new Error(`The run has no such report: ${name}`)
  return readFileSync(join(dir, name), 'utf8')
}

const FILE_MANAGER: Readonly<Record<string, (path: string) => [string, string[]]>> = {
  // Finder opens the folder and selects the file.
  darwin: (path) => ['open', ['-R', path]],
}

/** Free space on the volume a folder lies on: a fix copies samples into the projects. */
export async function freeBytesAt(path: string): Promise<number | undefined> {
  if (!path || !isAbsolute(path) || !existsSync(path)) return undefined
  return createNodeHost({ write: true }).write?.freeBytes(path)
}

/** Whether this computer can show a file in its file manager. */
export const canReveal = (settings: WebSettings = {}): boolean =>
  Boolean(settings.reveal) || process.platform in FILE_MANAGER

export async function webReveal(path: string, settings: WebSettings = {}): Promise<void> {
  if (!path || !isAbsolute(path) || !existsSync(path))
    throw new Error(`This file does not exist: ${path}`)
  if (settings.reveal) return settings.reveal(path)
  const command = FILE_MANAGER[process.platform]?.(path)
  if (!command) throw new Error('Showing a file is not supported on this system.')
  await new Promise<void>((resolve, reject) => {
    // No shell: the path is one argument, whatever characters it has.
    execFile(command[0], command[1], (error) => (error ? reject(error) : resolve()))
  })
}
