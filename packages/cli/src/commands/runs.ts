import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createNodeHost, liveIsRunning } from '@livesaver/node'
import { type RunSummary, readJournal, runSummary, runText, undoRun } from '@livesaver/ops'
import pc from 'picocolors'
import { resolveConfig } from '../config.js'
import { acquireLock, listRuns, readRun, runsDir } from '../state.js'

/** Every run folder as a summary, oldest first. */
export async function runSummaries(): Promise<RunSummary[]> {
  const host = createNodeHost()
  const runs: RunSummary[] = []
  for (const id of listRuns()) {
    const entries = await readJournal(host, { id, dir: join(runsDir(), id) })
    runs.push(runSummary(id, entries, readRun(id)))
  }
  return runs
}

export async function runRuns(): Promise<number> {
  const runs = await runSummaries()
  if (runs.length === 0) {
    console.log(pc.dim(`no runs yet (${runsDir()})`))
    return 0
  }
  for (const run of runs) {
    const bits = [
      runText(run),
      run.unfinished ? pc.yellow(`${run.unfinished} unfinished`) : '',
      run.state === 'undone' ? pc.cyan('undone') : '',
      run.state === 'partly-undone' ? pc.cyan('partly undone') : '',
    ].filter(Boolean)
    console.log(`${run.id}  ${pc.dim(bits.join(' · '))}`)
  }
  return 0
}

export interface UndoFlags {
  readonly config?: string
  readonly force?: boolean
}

export async function runUndo(id: string, flags: UndoFlags): Promise<number> {
  const dir = join(runsDir(), id)
  if (!existsSync(join(dir, 'journal.jsonl'))) {
    console.error(`not an applied run: ${id}`)
    return 2
  }
  if (liveIsRunning() && !flags.force) {
    console.error('Ableton Live is running – quit it first (or use --force).')
    return 1
  }
  const release = acquireLock()
  try {
    const config = await resolveConfig({
      ...(flags.config ? { config: flags.config } : {}),
    })
    const report = await undoRun(
      createNodeHost({
        write: true,
        ...(process.env.LIVESAVER_TRASH_DIR ? { trashDir: process.env.LIVESAVER_TRASH_DIR } : {}),
      }),
      { id, dir },
      config.env,
    )
    const line = (label: string, items: readonly string[]) => {
      if (items.length)
        console.log(`${label}: ${items.length}\n${items.map((i) => `  ${i}`).join('\n')}`)
    }
    line('Restored', report.restored)
    line('Already restored', report.alreadyRestored)
    line('Changed since (left alone)', report.changedSince)
    line('Moved to the Trash', report.trashed)
    line('Still used (kept)', report.stillUsed)
    line('Moved back', report.renamedBack)
    line('Tags restored', report.tagsRestored)
    line('Comments restored', report.commentsRestored)
    line('Files restored', report.filesRestored)
    line('Unfinished steps', report.unfinished)
    line('Problems', report.problems)
    return report.changedSince.length || report.problems.length ? 1 : 0
  } finally {
    release()
  }
}
