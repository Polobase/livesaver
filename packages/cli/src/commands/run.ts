import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { formatCsv } from '@livesaver/core'
import { createNodeHost, liveIsRunning } from '@livesaver/node'
import {
  applyWriter,
  BUILTIN_CODEMODS,
  type Codemod,
  type CodemodResult,
  Probe,
  runCodemod,
} from '@livesaver/ops'
import pc from 'picocolors'
import { absolute } from '../config.js'
import { join } from '../paths.js'
import { acquireLock, endRun, newRun } from '../state.js'

export interface RunFlags {
  readonly apply?: boolean
  readonly force?: boolean
  readonly option?: string[]
  readonly exclude?: string[]
  readonly reportDir?: string
  readonly json?: boolean
}

/** A built-in codemod by name, or the default export of a module (`.ts` under Bun and Node ≥ 22.18). */
export async function loadCodemod(spec: string): Promise<Codemod> {
  const builtin = BUILTIN_CODEMODS.get(spec)
  if (builtin) return builtin
  const path = absolute(spec)
  if (!existsSync(path))
    throw new Error(
      `no built-in codemod and no file called ${spec} (built-in: ${[...BUILTIN_CODEMODS.keys()].join(', ')})`,
    )
  const mod = (await import(pathToFileURL(path).href)) as { default?: unknown; codemod?: unknown }
  const codemod = (mod.default ?? mod.codemod) as Partial<Codemod> | undefined
  if (!codemod || typeof codemod.name !== 'string' || typeof codemod.transform !== 'function')
    throw new Error(`${spec} does not export a codemod (default export with name and transform)`)
  return codemod as Codemod
}

function parseOptions(pairs: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of pairs) {
    const cut = pair.indexOf('=')
    if (cut <= 0) throw new Error(`--option ${pair}: expected key=value`)
    out[pair.slice(0, cut)] = pair.slice(cut + 1)
  }
  return out
}

function report(results: readonly CodemodResult[], base: string): string {
  return formatCsv([
    ['Set', 'Changed', 'Edits', 'Written', 'Backup', 'Notes', 'Error'],
    ...results
      .filter((r) => r.changed || r.notes.length || r.error)
      .map((r) => [
        r.setPath.startsWith(`${base}/`) ? r.setPath.slice(base.length + 1) : r.setPath,
        r.changed ? 'yes' : 'no',
        r.edits,
        r.written ? 'yes' : '',
        r.backup,
        r.notes.join(' | '),
        r.error,
      ]),
  ])
}

/** `livesaver run`: run a codemod over sets (dry run unless --apply). */
export async function runRun(
  spec: string | undefined,
  targetArgs: string[],
  flags: RunFlags & { list?: boolean },
): Promise<number> {
  if (flags.list || !spec) {
    for (const c of BUILTIN_CODEMODS.values()) {
      console.log(`${pc.bold(c.name)}  ${c.description ?? ''}`)
      for (const [k, v] of Object.entries(c.options ?? {}))
        console.log(pc.dim(`    --option ${k}=…  ${v}`))
    }
    return flags.list ? 0 : 2
  }
  const apply = Boolean(flags.apply)
  const targets = targetArgs.map(absolute)
  for (const target of targets) {
    if (!existsSync(target)) {
      console.error(`not found: ${target}`)
      return 2
    }
  }
  let codemod: Codemod
  let options: Record<string, string>
  try {
    codemod = await loadCodemod(spec)
    options = parseOptions(flags.option ?? [])
  } catch (error) {
    console.error((error as Error).message)
    return 2
  }
  if (apply && liveIsRunning() && !flags.force) {
    console.error('Ableton Live is running – quit it first (or use --force).')
    return 1
  }
  const release = apply ? acquireLock() : () => {}
  try {
    const host = createNodeHost({
      write: apply,
      ...(process.env.LIVESAVER_TRASH_DIR ? { trashDir: process.env.LIVESAVER_TRASH_DIR } : {}),
    })
    const run = await newRun(`run-${codemod.name}`, apply, {
      targets,
      options: { ...options, exclude: flags.exclude ?? [] },
    })
    const probe = new Probe(host.fs, host.hash)
    const tty = process.stderr.isTTY && !flags.json
    const result = await runCodemod(host, codemod, {
      targets,
      excludes: (flags.exclude ?? []).map(absolute),
      options,
      probe,
      ...(apply ? { writer: applyWriter(host, run, probe) } : {}),
      onSet: (_r, i, n) => {
        if (tty) process.stderr.write(`\r\x1b[2K[${i}/${n}]`)
      },
    })
    if (tty) process.stderr.write('\r\x1b[2K')
    const dir = flags.reportDir ? absolute(flags.reportDir) : run.dir
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'codemod.csv'), report(result.results, result.base))
    const changed = result.results.filter((r) => r.changed)
    const errors = result.results.filter((r) => r.error)
    await endRun(run, {
      sets: result.results.length,
      changed: changed.length,
      errors: errors.length,
    })
    if (flags.json) {
      console.log(
        JSON.stringify(
          { run: run.id, reports: dir, codemod: codemod.name, results: result.results },
          null,
          2,
        ),
      )
    } else {
      if (!apply) console.log('DRY RUN – nothing was changed (to do it: --apply)')
      for (const r of [
        ...changed,
        ...result.results.filter((x) => !x.changed && x.notes.length),
      ].slice(0, 30))
        console.log(
          `${r.changed ? pc.green('±') : ' '} ${r.setPath}${r.notes.length ? pc.dim(`  ${r.notes.join('; ')}`) : ''}`,
        )
      for (const r of errors.slice(0, 10)) console.log(pc.red(`! ${r.setPath}: ${r.error}`))
      console.log(
        `${codemod.name}: ${result.results.length} sets, ${changed.length} ${apply ? 'changed' : 'would change'}${errors.length ? `, ${errors.length} errors` : ''}`,
      )
      console.log(pc.dim(`Report: ${dir}`))
      if (apply && changed.length) console.log(pc.dim(`Undo: livesaver undo ${run.id}`))
    }
    return errors.length ? 1 : 0
  } finally {
    release()
  }
}
