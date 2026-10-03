import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { posix } from '@livesaver/core'
import { createNodeHost, createWorkerParser, liveIsRunning } from '@livesaver/node'
import {
  CompleteSets,
  emptyFolders,
  formatReorgPlan,
  Journal,
  lockFileOf,
  parseReorgPlan,
  REORG_FILES,
  readSheet,
  readSnapshot,
  readTextFile,
  reorgReport,
  reorgSummary,
  runReorg,
  suggestReorg,
  typedCells,
} from '@livesaver/ops'
import pc from 'picocolors'
import { absolute, resolveConfig, resolveStatusConfig } from '../config.js'
import {
  acquireLock,
  cachePath,
  endRun,
  newRun,
  readText,
  sheetSnapshotPath,
  writeStateFile,
} from '../state.js'

export interface ReorgFlags {
  readonly into?: string
  readonly exclude?: string[]
  readonly apply?: boolean
  readonly force?: boolean
  readonly config?: string
  readonly reportDir?: string
}

function base(flags: ReorgFlags, fallback: string): string {
  if (flags.into) return absolute(flags.into)
  const status = resolveStatusConfig({
    ...(flags.config ? { config: flags.config } : {}),
  })
  return status.projects ?? fallback
}

/** `livesaver reorg plan`: a plan from the decision tags (changes nothing). */
export async function runReorgPlan(folderArgs: string[], flags: ReorgFlags): Promise<number> {
  const folders = folderArgs.map(absolute)
  for (const f of folders) {
    if (!existsSync(f)) {
      console.error(`not found: ${f}`)
      return 2
    }
  }
  const status = resolveStatusConfig({
    ...(flags.config ? { config: flags.config } : {}),
  })
  const into = base(flags, folders[0] as string)
  const host = createNodeHost()
  if (status.sheet) {
    const snapshot = await readSnapshot(host, sheetSnapshotPath(status.sheet))
    const sheetText = await readTextFile(host, status.sheet)
    const typed = sheetText ? typedCells(readSheet(sheetText), snapshot) : new Map()
    if (typed.size || existsSync(lockFileOf(status.sheet)))
      console.log(
        pc.yellow(
          `Note: ${status.sheet} has entries not yet taken over as tags (or is open). Save it and run “livesaver status … --apply” first, or they are missing here.`,
        ),
      )
  }
  const rows = await suggestReorg(
    host,
    folders,
    into,
    status.profile,
    (flags.exclude ?? []).map(absolute),
  )
  const run = await newRun('reorg-plan', false, {
    targets: folders,
    options: { into, exclude: flags.exclude ?? [] },
  })
  const dir = flags.reportDir ? absolute(flags.reportDir) : run.dir
  mkdirSync(dir, { recursive: true })
  const planPath = join(dir, REORG_FILES.plan)
  writeFileSync(planPath, formatReorgPlan(rows))
  await endRun(run, { projects: rows.length })
  for (const r of rows) {
    const target = r.target ? relative(into, r.target) : '–'
    console.log(
      `${relative(into, r.project)}  →  ${target}${r.note ? pc.dim(`   (${r.note})`) : ''}`,
    )
  }
  console.log(`${rows.length} projects. Plan to check and adjust: ${planPath}`)
  console.log(pc.dim(`livesaver reorg run ${planPath} [--apply]`))
  return 0
}

/** `livesaver reorg run`: check a plan and, with --apply, move the folders. */
export async function runReorgRun(planArg: string, flags: ReorgFlags): Promise<number> {
  const apply = Boolean(flags.apply)
  const planPath = absolute(planArg)
  const text = readText(planPath)
  if (text === undefined) {
    console.error(`not found: ${planPath}`)
    return 2
  }
  const moves = parseReorgPlan(text, absolute)
  if (!moves.length) {
    console.error('the plan has no rows with project and target')
    return 2
  }
  if (apply && liveIsRunning() && !flags.force) {
    console.error('Ableton Live is running – quit it first.')
    return 1
  }
  const status = resolveStatusConfig({
    ...(flags.config ? { config: flags.config } : {}),
  })
  const into = base(flags, posix.commonpath(moves.map((m) => posix.dirname(m.source))))
  const release = apply ? acquireLock() : () => {}
  try {
    const config = await resolveConfig({
      ...(flags.config ? { config: flags.config } : {}),
    })
    const host = createNodeHost({
      write: apply,
      ...(process.env.LIVESAVER_TRASH_DIR ? { trashDir: process.env.LIVESAVER_TRASH_DIR } : {}),
    })
    const run = await newRun('reorg', apply, { targets: [planPath], options: { into } })
    const parser = createWorkerParser({ host })
    const cacheText = readText(cachePath())
    const cache = apply && cacheText !== undefined ? CompleteSets.parse(cacheText, 0) : undefined
    console.log(pc.dim('Checking whether other sets use files of the projects …'))
    const r = await runReorg({ host, env: config.env, profile: status.profile, parser }, moves, {
      base: into,
      apply,
      ...(apply ? { journal: new Journal(host, run) } : {}),
      ...(cache ? { cache } : {}),
    })
    await parser.close()
    if (!r.started) {
      console.error(`Finder comments unreadable (${r.commentError}) – nothing is moved.`)
      await endRun(run, {}, `Finder comments unreadable (${r.commentError})`)
      return 1
    }
    if (cache) {
      await writeStateFile(cachePath(), cache.serialize())
      if (r.pruned) console.log(pc.dim(`${r.pruned} stale cache entries removed`))
    }
    if (r.commentError)
      console.log(pc.yellow(`Comments of the moved folders not set: ${r.commentError}`))
    const dir = flags.reportDir ? absolute(flags.reportDir) : run.dir
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, REORG_FILES.report), reorgReport(moves, into))
    await endRun(run, {
      projects: moves.length,
      problems: moves.filter((m) => m.problems.length).length,
    })
    console.log(reorgSummary(moves, apply, into))
    if (apply) {
      const leftovers = await emptyFolders(host, [into])
      if (leftovers.length)
        console.log(
          'Empty now (delete by hand if you like): ' +
            leftovers.map((f) => relative(into, f)).join(', '),
        )
      console.log(pc.dim(`Undo: livesaver undo ${run.id}`))
    }
    console.log(pc.dim(`Report: ${dir}`))
    return moves.some((m) => m.problems.length) ? 1 : 0
  } finally {
    release()
  }
}
