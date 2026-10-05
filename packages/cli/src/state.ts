/** livesaver's own state: run folders (journal, originals, reports) and the run lock. */
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { mkdir } from 'node:fs/promises'
import type { RunContext, RunRecord } from '@livesaver/ops'
import { dirname, home, join, slashed, windowsFolder } from './paths.js'

export function stateDir(): string {
  if (process.env.LIVESAVER_HOME) return slashed(process.env.LIVESAVER_HOME)
  if (process.platform === 'darwin')
    return join(home(), 'Library', 'Application Support', 'livesaver')
  if (process.platform === 'win32')
    return join(windowsFolder('LOCALAPPDATA', join(home(), 'AppData', 'Local')), 'livesaver')
  return join(process.env.XDG_STATE_HOME ?? join(home(), '.local', 'state'), 'livesaver')
}

export function runsDir(): string {
  return join(stateDir(), 'runs')
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** What a run is asked to do: the journal says what changed, but not what for. */
export interface RunAsked {
  readonly targets: readonly string[]
  /** The options that shape the run, named as on the command line. */
  readonly options?: Readonly<Record<string, unknown>>
}

const RECORD = 'run.json'

/**
 * A new run folder, e.g. runs/2026-09-30_214501_collect_apply, with a note of what was asked
 * (`run.json`), which `endRun` completes.
 */
export async function newRun(
  command: string,
  apply: boolean,
  asked: RunAsked,
  now = new Date(),
): Promise<RunContext> {
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const base = `${stamp}_${command}_${apply ? 'apply' : 'dry-run'}`
  let id = base
  for (let n = 2; existsSync(join(runsDir(), id)); n++) id = `${base}-${n}`
  const dir = join(runsDir(), id)
  await mkdir(dir, { recursive: true })
  const record: RunRecord = {
    version: 1,
    command,
    apply,
    targets: asked.targets,
    options: asked.options ?? {},
    started: now.toISOString(),
  }
  await writeStateFile(join(dir, RECORD), JSON.stringify(record, null, 2))
  return { id, dir }
}

/** Note how a run ended: the numbers worth showing later, or why it failed. */
export async function endRun(
  run: RunContext,
  outcome: Readonly<Record<string, number>> = {},
  error = '',
): Promise<void> {
  const record = readRun(run.id)
  if (!record) return
  const ended: RunRecord = {
    ...record,
    ended: new Date().toISOString(),
    outcome,
    ...(error ? { error } : {}),
  }
  await writeStateFile(join(run.dir, RECORD), JSON.stringify(ended, null, 2))
}

/** A run's note of what it was asked; runs of older versions have none. */
export function readRun(id: string): RunRecord | undefined {
  try {
    const record = JSON.parse(readText(join(runsDir(), id, RECORD)) ?? '') as Partial<RunRecord>
    return record.version === 1 && typeof record.command === 'string'
      ? (record as RunRecord)
      : undefined
  } catch {
    return undefined
  }
}

export function listRuns(): string[] {
  try {
    return readdirSync(runsDir(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

/** Exclusive lock for applying runs; a lock whose process is gone is taken over. */
export function acquireLock(): () => void {
  mkdirSync(stateDir(), { recursive: true })
  const path = join(stateDir(), 'lock')
  if (existsSync(path)) {
    const pid = Number(readFileSync(path, 'utf8').trim())
    let alive = false
    try {
      if (pid) {
        process.kill(pid, 0)
        alive = true
      }
    } catch {}
    if (alive)
      throw new Error(`another livesaver run is applying changes (pid ${pid}); lock: ${path}`)
    rmSync(path, { force: true })
  }
  writeFileSync(path, String(process.pid), { flag: 'wx' })
  return () => rmSync(path, { force: true })
}

export function cachePath(): string {
  return join(stateDir(), 'cache', 'complete-sets.json')
}

export function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/** Atomically write one of livesaver's own state files. */
export async function writeStateFile(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, path)
}

/** Where livesaver remembers what it wrote into a rating sheet (one file per sheet). */
export function sheetSnapshotPath(sheet: string): string {
  const id = createHash('sha1').update(sheet).digest('hex').slice(0, 16)
  return join(stateDir(), 'sheets', `${id}.json`)
}

/** The `auval -a` result, kept until an Audio Unit bundle changes. */
export function audioUnitsCachePath(): string {
  return join(stateDir(), 'cache', 'audio-units.json')
}
