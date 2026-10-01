import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createNodeHost, createWorkerParser, liveIsRunning } from '@livesaver/node'
import {
  applyWriter,
  buildReports,
  CompleteSets,
  doctor,
  Probe,
  summary,
  totalCounts,
} from '@livesaver/ops'
import pc from 'picocolors'
import { absolute, resolveConfig } from '../config.js'
import { acquireLock, cachePath, newRun, readText, writeStateFile } from '../state.js'

export interface DoctorFlags {
  readonly search?: string[]
  readonly defaultSearch?: boolean
  readonly ignore?: string[]
  readonly exclude?: string[]
  readonly packLimit?: string
  readonly config?: string
  readonly json?: boolean
  readonly quiet?: boolean
  readonly workers?: string
  readonly reportDir?: string
  readonly apply?: boolean
  readonly force?: boolean
  readonly full?: boolean
}

/**
 * `doctor` (read-only) and `collect` (dry run, or `--apply`) share this pipeline; `collect` always
 * gets a run folder with reports, and with --apply a journal and the original sets for `undo`.
 */
export async function runCollect(
  command: 'doctor' | 'collect',
  targetArgs: string[],
  flags: DoctorFlags,
): Promise<number> {
  const apply = command === 'collect' && Boolean(flags.apply)
  const targets = targetArgs.map(absolute)
  for (const target of targets) {
    if (!existsSync(target)) {
      console.error(`not found: ${target}`)
      return 2
    }
  }
  if (apply && liveIsRunning() && !flags.force) {
    console.error(
      'Ableton Live is running – quit it first so no open set gets overwritten (or use --force).',
    )
    return 1
  }
  const release = apply ? acquireLock() : () => {}
  try {
    const config = await resolveConfig({
      ...(flags.config ? { config: flags.config } : {}),
      search: flags.search ?? [],
      noDefaultSearch: flags.defaultSearch === false,
      ...(flags.packLimit !== undefined ? { packLimit: Number(flags.packLimit) } : {}),
      targets,
    })
    const host = createNodeHost({
      write: apply,
      ...(process.env.LIVESAVER_TRASH_DIR ? { trashDir: process.env.LIVESAVER_TRASH_DIR } : {}),
    })
    const run = command === 'collect' ? await newRun(command, apply) : undefined
    const probe = new Probe(host.fs, host.hash)
    const writer = apply && run ? applyWriter(host, run, probe) : undefined
    const parser = createWorkerParser({
      host,
      ...(flags.workers !== undefined ? { workers: Number(flags.workers) } : {}),
    })
    const cache = flags.full
      ? undefined
      : CompleteSets.parse(readText(cachePath()), config.packCopyLimit)
    const tty = process.stderr.isTTY && !flags.quiet && !flags.json
    const log = (line: string) => {
      if (!flags.quiet && !flags.json) process.stderr.write(`${line}\n`)
    }
    log(pc.dim('Building search index …'))
    const result = await doctor(host, {
      targets,
      searchRoots: config.searchRoots,
      ignore: (flags.ignore ?? []).map(absolute),
      excludes: (flags.exclude ?? []).map(absolute),
      env: config.env,
      packCopyLimit: config.packCopyLimit,
      parser,
      probe,
      ...(cache ? { cache } : {}),
      ...(writer ? { writer } : {}),
      onEvent: (e) => {
        if (e.type === 'index') {
          log(
            `  ${e.files.toLocaleString()} audio files and Max devices in ${e.roots} search root${e.roots === 1 ? '' : 's'} (${(e.ms / 1000).toFixed(1)} s)`,
          )
        } else if (e.type === 'set') {
          if (tty) {
            const name = relative(process.cwd(), e.result.setPath)
            process.stderr.write(`\r\x1b[2K[${e.index}/${e.total}] ${name.slice(-80)}`)
          }
        }
      },
    })
    await parser.close()
    if (cache) await writeStateFile(cachePath(), cache.serialize())
    if (tty) process.stderr.write('\r\x1b[2K')

    const reportDir = flags.reportDir ? absolute(flags.reportDir) : run?.dir
    if (reportDir) {
      mkdirSync(reportDir, { recursive: true })
      const files = await buildReports(result.results, result.base, probe)
      for (const [name, content] of Object.entries(files))
        writeFileSync(join(reportDir, name), content)
    }

    if (flags.json) {
      console.log(
        JSON.stringify(
          {
            run: run?.id,
            reports: reportDir,
            base: result.base,
            ms: Math.round(result.ms),
            index: {
              files: result.index.fileCount,
              roots: result.index.roots,
              unreadable: result.index.unreadable,
            },
            counts: totalCounts(result.results),
            sets: result.results.map((r) => ({
              set: r.setPath,
              project: r.projectRoot,
              creator: r.creator,
              error: r.error || undefined,
              written: r.written || undefined,
              backup: r.backup || undefined,
              counts: r.counts,
              changes: r.changes,
              missing: r.missing.map((m) => ({
                name: m.ref.name,
                path: m.ref.path || m.ref.hintPath || m.ref.relPath,
                kind: m.ref.kind,
                status: m.choice.status,
                candidates: m.choice.candidates,
              })),
            })),
          },
          null,
          2,
        ),
      )
    } else {
      console.log(summary(result.results, result.projects, apply))
      if (result.index.unreadable.length) {
        console.log(
          pc.yellow(
            `Warning: ${result.index.unreadable.length} folders could not be read (permissions / privacy), e.g. ${result.index.unreadable[0]}`,
          ),
        )
      }
      console.log(pc.dim(`Time: ${(result.ms / 1000).toFixed(1)} s`))
      if (reportDir) console.log(pc.dim(`Reports: ${reportDir}`))
      if (apply && run) console.log(pc.dim(`Undo: livesaver undo ${run.id}`))
    }
    return result.results.some((r) => r.error) ? 1 : 0
  } finally {
    release()
  }
}

export const runDoctor = (targets: string[], flags: DoctorFlags) =>
  runCollect('doctor', targets, flags)
