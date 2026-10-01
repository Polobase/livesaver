import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { posix } from '@livesaver/core'
import { createNodeHost, createWorkerParser, liveIsRunning } from '@livesaver/node'
import {
  executeMove,
  failedMove,
  formatMovePlan,
  Journal,
  MOVE_FILES,
  MOVE_TEXT,
  type Move,
  moveReport,
  moveSummary,
  parseMovePlan,
  planMove,
  suggestMoves,
} from '@livesaver/ops'
import pc from 'picocolors'
import { absolute, resolveConfig } from '../config.js'
import { acquireLock, newRun, readText } from '../state.js'

export interface MoveFlags {
  readonly exclude?: string[]
  readonly apply?: boolean
  readonly force?: boolean
  readonly config?: string
  readonly reportDir?: string
}

/** `livesaver move plan`: find sets saved into another song's project (changes nothing). */
export async function runMovePlan(folderArgs: string[], flags: MoveFlags): Promise<number> {
  const folders = folderArgs.map(absolute)
  for (const f of folders) {
    if (!existsSync(f)) {
      console.error(`not found: ${f}`)
      return 2
    }
  }
  const config = await resolveConfig({
    ...(flags.config ? { config: flags.config } : {}),
  })
  const host = createNodeHost()
  const parser = createWorkerParser({ host })
  const rows = await suggestMoves(
    { host, env: config.env, parser },
    folders,
    (flags.exclude ?? []).map(absolute),
  )
  await parser.close()
  const run = await newRun('move-plan', false)
  const dir = flags.reportDir ? absolute(flags.reportDir) : run.dir
  mkdirSync(dir, { recursive: true })
  const planPath = join(dir, MOVE_FILES.plan)
  writeFileSync(planPath, formatMovePlan(rows))
  const base = posix.commonpath(folders)
  for (const r of rows)
    console.log(
      `${relative(base, r.set)}  →  ${relative(base, r.target)}${pc.dim(`   (${r.note})`)}`,
    )
  console.log(`${rows.length} sets. Plan to check and adjust: ${planPath}`)
  console.log(pc.dim(`livesaver move run ${planPath} [--apply]`))
  return 0
}

async function runMoves(groups: [string, string[]][], flags: MoveFlags): Promise<number> {
  const apply = Boolean(flags.apply)
  if (apply && liveIsRunning() && !flags.force) {
    console.error('Ableton Live is running – quit it first.')
    return 1
  }
  const release = apply ? acquireLock() : () => {}
  try {
    const config = await resolveConfig({
      ...(flags.config ? { config: flags.config } : {}),
    })
    const host = createNodeHost({
      write: apply,
      ...(process.env.LIVESAVER_TRASH_DIR ? { trashDir: process.env.LIVESAVER_TRASH_DIR } : {}),
    })
    const run = await newRun('move', apply)
    const journal = apply ? new Journal(host, run) : undefined
    const parser = createWorkerParser({ host })
    const ctx = { host, env: config.env, parser }
    const moves: Move[] = []
    for (const [target, sets] of groups) {
      let move: Move
      try {
        move = await planMove(ctx, sets, target)
      } catch (error) {
        move = failedMove(posix.dirname(sets[0] as string), target, (error as Error).message)
      }
      if (apply && !move.problems.length) {
        try {
          await executeMove(ctx, move, journal)
        } catch (error) {
          move.problems.push(MOVE_TEXT.aborted((error as Error).message))
        }
      }
      moves.push(move)
    }
    await parser.close()
    const base = posix.commonpath([
      ...moves.map((m) => m.sourceRoot),
      ...moves.map((m) => m.target),
    ])
    const dir = flags.reportDir ? absolute(flags.reportDir) : run.dir
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, MOVE_FILES.report), moveReport(moves, base, apply))
    console.log(moveSummary(moves, apply, base))
    if (apply) console.log(pc.dim(`Undo: livesaver undo ${run.id}`))
    console.log(pc.dim(`Report: ${dir}`))
    return moves.some((m) => m.problems.length) ? 1 : 0
  } finally {
    release()
  }
}

/** `livesaver move run`: carry out a plan (dry run unless --apply). */
export async function runMoveRun(planArg: string, flags: MoveFlags): Promise<number> {
  const text = readText(absolute(planArg))
  if (text === undefined) {
    console.error(`not found: ${absolute(planArg)}`)
    return 2
  }
  const groups = parseMovePlan(text, absolute)
  if (!groups.length) {
    console.error('the plan has no rows with set and target project')
    return 2
  }
  return runMoves(groups, flags)
}

/** `livesaver move sets <target> <sets...>`: move these sets into the target project. */
export async function runMoveSets(
  targetArg: string,
  setArgs: string[],
  flags: MoveFlags,
): Promise<number> {
  return runMoves([[absolute(targetArg), setArgs.map(absolute)]], flags)
}
