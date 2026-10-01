import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createNodeHost, liveIsRunning } from '@livesaver/node'
import { readJournal, undoRun } from '@livesaver/ops'
import pc from 'picocolors'
import { resolveConfig } from '../config.js'
import { acquireLock, listRuns, runsDir } from '../state.js'

export async function runRuns(): Promise<number> {
  const host = createNodeHost()
  const ids = listRuns()
  if (ids.length === 0) {
    console.log(pc.dim(`no runs yet (${runsDir()})`))
    return 0
  }
  for (const id of ids) {
    const dir = join(runsDir(), id)
    const entries = await readJournal(host, { id, dir })
    const count = (op: string) => entries.filter((e) => e.t === 'end' && e.op === op).length
    const sets = count('write-set')
    const copies = count('copy')
    const renames = count('rename')
    const tags = count('tags')
    const comments = entries
      .filter((e) => e.t === 'begin' && e.op === 'comments')
      .reduce((n, e) => n + (e.t === 'begin' && e.op === 'comments' ? e.items.length : 0), 0)
    const begun = new Set(entries.filter((e) => e.t === 'begin').map((e) => e.id))
    const ended = new Set(entries.filter((e) => e.t === 'end').map((e) => e.id))
    const unfinished = [...begun].filter((x) => !ended.has(x)).length
    const undone = entries.some((e) => e.t === 'undo')
    const done = [
      sets ? `${sets} sets written` : '',
      copies ? `${copies} files copied` : '',
      renames ? `${renames} moved` : '',
      tags ? `${tags} tags set` : '',
      comments ? `${comments} comments set` : '',
    ].filter(Boolean)
    const bits = [
      entries.length ? done.join(', ') || 'nothing changed' : 'dry run',
      unfinished ? pc.yellow(`${unfinished} unfinished`) : '',
      undone ? pc.cyan('undone') : '',
    ].filter(Boolean)
    console.log(`${id}  ${pc.dim(bits.join(' · '))}`)
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
