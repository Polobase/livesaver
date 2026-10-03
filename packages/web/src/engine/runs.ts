/**
 * Runs as a page keeps them: in its own storage (the origin's private file system), one folder
 * per run with the journal, the originals of the sets it rewrote, its reports and a note of what
 * was asked, as the command line keeps them in its state folder. The data of an undo therefore
 * lives in this browser, for this site: another browser, or cleared site data, has none of it.
 */
import { type Host, posix } from '@livesaver/core'
import {
  type RunContext,
  type RunRecord,
  type RunStep,
  type RunSummary,
  readJournal,
  runSteps,
  runSummary,
} from '@livesaver/ops'

/** Where the page's own storage is mounted: a path no folder of the user can have. */
export const STATE_PATH = '/.livesaver-in-this-browser'
const RUNS = posix.join(STATE_PATH, 'runs')
const RECORD = 'run.json'
/** What livesaver keeps in a run folder for itself; everything else in it is a report. */
const OWN = new Set(['journal.jsonl', RECORD])

export interface BrowserRun extends RunSummary {
  /** The report files in the run's folder. */
  readonly reports: readonly string[]
}

export interface BrowserRunDetail {
  readonly run: BrowserRun
  readonly steps: readonly RunStep[]
}

const pad = (n: number) => String(n).padStart(2, '0')
const decode = (data: Uint8Array) => new TextDecoder().decode(data)

function writer(host: Host) {
  if (!host.write) throw new Error('This page cannot write here.')
  return host.write
}

/** A new run folder, named as the command line names them, with a note of what was asked. */
export async function newRun(
  host: Host,
  command: string,
  asked: { readonly targets: readonly string[]; readonly options: Record<string, unknown> },
  now = new Date(),
): Promise<RunContext> {
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const base = `${stamp}_${command}_apply`
  let id = base
  for (let n = 2; (await host.fs.kind?.(posix.join(RUNS, id))) !== undefined; n++)
    id = `${base}-${n}`
  const dir = posix.join(RUNS, id)
  const record: RunRecord = {
    version: 1,
    command,
    apply: true,
    targets: asked.targets,
    options: asked.options,
    started: now.toISOString(),
  }
  await writer(host).writeFile(posix.join(dir, RECORD), JSON.stringify(record, null, 2))
  return { id, dir }
}

async function readRecord(host: Host, dir: string): Promise<RunRecord | undefined> {
  try {
    const record = JSON.parse(decode(await host.fs.readFile(posix.join(dir, RECORD))))
    return record?.version === 1 && typeof record.command === 'string' ? record : undefined
  } catch {
    return undefined
  }
}

/** Notes how a run ended: the numbers worth showing later, or why it failed. */
export async function endRun(
  host: Host,
  run: RunContext,
  outcome: Readonly<Record<string, number>>,
  error = '',
): Promise<void> {
  const record = await readRecord(host, run.dir)
  if (!record) return
  const ended: RunRecord = {
    ...record,
    ended: new Date().toISOString(),
    outcome,
    ...(error ? { error } : {}),
  }
  await writer(host).writeFile(posix.join(run.dir, RECORD), JSON.stringify(ended, null, 2))
}

/** The folder of a run; its name is of livesaver's own making, nothing that leads elsewhere. */
export function runFolder(id: string): RunContext {
  if (!/^\w[\w.-]*$/.test(id)) throw new Error(`There is no such run: ${id}`)
  return { id, dir: posix.join(RUNS, id) }
}

async function summary(host: Host, id: string): Promise<BrowserRunDetail> {
  const run = runFolder(id)
  const names = await host.fs.listDir(run.dir)
  if (!names) throw new Error(`There is no such run: ${id}`)
  const entries = await readJournal(host, run)
  const reports = names
    .filter((entry) => !entry.isDirectory && !OWN.has(entry.name) && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort()
  return {
    run: { ...runSummary(id, entries, await readRecord(host, run.dir)), reports },
    steps: runSteps(entries),
  }
}

/** Every run this browser keeps for this site, the newest first. */
export async function listRuns(host: Host): Promise<BrowserRun[]> {
  const folders = (await host.fs.listDir(RUNS)) ?? []
  const ids = folders
    .filter((entry) => entry.isDirectory)
    .map((entry) => entry.name)
    .sort()
    .reverse()
  const runs: BrowserRun[] = []
  for (const id of ids) runs.push((await summary(host, id)).run)
  return runs
}

export const runDetail = (host: Host, id: string): Promise<BrowserRunDetail> => summary(host, id)

/** A report file of a run, as text. */
export async function runReport(host: Host, id: string, name: string): Promise<string> {
  const { run } = await summary(host, id)
  if (!run.reports.includes(name)) throw new Error(`The run has no such report: ${name}`)
  return decode(await host.fs.readFile(posix.join(runFolder(id).dir, name)))
}
