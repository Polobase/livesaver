import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createNodeHost, createWorkerParser, loadInstalledPlugins } from '@livesaver/node'
import { Journal, statusRun, statusSummary } from '@livesaver/ops'
import pc from 'picocolors'
import { absolute, resolveConfig, resolveStatusConfig } from '../config.js'
import { acquireLock, audioUnitsCachePath, newRun, sheetSnapshotPath } from '../state.js'

export interface StatusFlags {
  readonly apply?: boolean
  readonly exclude?: string[]
  readonly comments?: boolean
  readonly auval?: boolean
  readonly exports?: string
  readonly sheet?: string | boolean
  readonly config?: string
  readonly reportDir?: string
  readonly workers?: string
  readonly json?: boolean
  readonly quiet?: boolean
}

/** `livesaver status`: progress and completeness of every set and project, as Finder tags and comments. */
export async function runStatus(targetArgs: string[], flags: StatusFlags): Promise<number> {
  const apply = Boolean(flags.apply)
  const targets = targetArgs.map(absolute)
  for (const target of targets) {
    if (!existsSync(target)) {
      console.error(`not found: ${target}`)
      return 2
    }
  }
  const status = resolveStatusConfig({
    ...(flags.config ? { config: flags.config } : {}),
    ...(typeof flags.sheet === 'string'
      ? { sheet: flags.sheet }
      : flags.sheet === false
        ? { sheet: false }
        : {}),
    ...(flags.exports ? { exports: flags.exports } : {}),
  })
  const release = apply ? acquireLock() : () => {}
  try {
    const config = await resolveConfig({
      ...(flags.config ? { config: flags.config } : {}),
      targets,
    })
    const log = (line: string) => {
      if (!flags.quiet && !flags.json) process.stderr.write(`${line}\n`)
    }
    const started = performance.now()
    log(pc.dim('Looking up installed plug-ins …'))
    const inventory = await loadInstalledPlugins({
      auvalCache: audioUnitsCachePath(),
      auval: flags.auval !== false,
    })
    const host = createNodeHost({
      write: apply,
      ...(process.env.LIVESAVER_TRASH_DIR ? { trashDir: process.env.LIVESAVER_TRASH_DIR } : {}),
    })
    const run = await newRun('status', apply)
    const parser = createWorkerParser({
      host,
      ...(flags.workers !== undefined ? { workers: Number(flags.workers) } : {}),
    })
    const tty = process.stderr.isTTY && !flags.quiet && !flags.json
    const result = await statusRun(host, {
      targets,
      excludes: (flags.exclude ?? []).map(absolute),
      env: config.env,
      inventory,
      exportsDir: status.exports,
      profile: status.profile,
      apply,
      comments: flags.comments !== false,
      parser,
      ...(apply ? { journal: new Journal(host, run) } : {}),
      ...(status.sheet
        ? {
            sheet: {
              path: status.sheet,
              snapshot: sheetSnapshotPath(status.sheet),
            },
          }
        : {}),
      onProgress: (p) => {
        if (p.type === 'sets') log(pc.dim(`analysing ${p.total} sets …`))
        else if (tty) process.stderr.write(`\r\x1b[2K[${p.done}/${p.total}]`)
      },
    })
    await parser.close()
    if (tty) process.stderr.write('\r\x1b[2K')
    const reportDir = flags.reportDir ? absolute(flags.reportDir) : run.dir
    mkdirSync(reportDir, { recursive: true })
    for (const [name, content] of result.reports) writeFileSync(join(reportDir, name), content)
    const ms = performance.now() - started
    if (flags.json) {
      console.log(
        JSON.stringify(
          {
            run: run.id,
            reports: reportDir,
            outcome: { ...result.outcome, comments: Object.fromEntries(result.outcome.comments) },
            projects: result.projects.map((p) => ({
              root: p.root,
              isProject: p.isProject,
              main: p.main?.path,
              tags: result.wanted.get(p.root)?.tags,
              comment: result.wanted.get(p.root)?.comment,
            })),
          },
          null,
          2,
        ),
      )
    } else {
      console.log('')
      console.log(
        statusSummary(
          result.projects,
          result.outcome,
          apply,
          flags.comments !== false,
          status.profile,
        ),
      )
      console.log(pc.dim(`Time: ${(ms / 1000).toFixed(0)} s`))
      console.log(pc.dim(`Reports: ${reportDir}`))
      if (apply) console.log(pc.dim(`Undo: livesaver undo ${run.id}`))
    }
    return result.outcome.commentError ? 1 : 0
  } finally {
    release()
  }
}
