import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Catalog, type FoundSet, indexSets, QueryError, searchCatalog } from '@livesaver/catalog'
import {
  createNodeHost,
  createWorkerParser,
  loadInstalledPlugins,
  openDatabase,
} from '@livesaver/node'
import { duration } from '@livesaver/ops'
import pc from 'picocolors'
import { absolute, resolveConfig } from '../config.js'
import { audioUnitsCachePath, stateDir } from '../state.js'

export function catalogPath(): string {
  return join(stateDir(), 'catalog.sqlite')
}

async function openCatalog(readonly = false): Promise<Catalog> {
  if (readonly && !existsSync(catalogPath())) {
    // A fresh catalog is created (schema only) so queries work and say "no sets".
    new Catalog(await openDatabase(catalogPath())).db.close()
  }
  return new Catalog(await openDatabase(catalogPath(), { readonly }))
}

export interface IndexFlags {
  readonly exclude?: string[]
  readonly full?: boolean
  readonly config?: string
  readonly workers?: string
  readonly auval?: boolean
  readonly json?: boolean
  readonly quiet?: boolean
}

/** `livesaver index`: bring the catalog up to date with these folders. */
export async function runIndex(targetArgs: string[], flags: IndexFlags): Promise<number> {
  const targets = targetArgs.map(absolute)
  for (const target of targets) {
    if (!existsSync(target)) {
      console.error(`not found: ${target}`)
      return 2
    }
  }
  const config = await resolveConfig({
    ...(flags.config ? { config: flags.config } : {}),
  })
  const inventory = await loadInstalledPlugins({
    auvalCache: audioUnitsCachePath(),
    auval: flags.auval !== false,
  })
  const host = createNodeHost()
  const parser = createWorkerParser({
    host,
    ...(flags.workers !== undefined ? { workers: Number(flags.workers) } : {}),
  })
  const catalog = await openCatalog()
  const tty = process.stderr.isTTY && !flags.quiet && !flags.json
  try {
    const result = await indexSets(host, catalog, {
      targets,
      excludes: (flags.exclude ?? []).map(absolute),
      env: config.env,
      inventory,
      parser,
      full: Boolean(flags.full),
      onProgress: (done, total) => {
        if (tty) process.stderr.write(`\r\x1b[2K[${done}/${total}]`)
      },
    })
    if (tty) process.stderr.write('\r\x1b[2K')
    const stats = catalog.stats()
    if (flags.json)
      console.log(JSON.stringify({ ...result, catalog: stats, path: catalogPath() }, null, 2))
    else {
      console.log(
        `${result.sets} sets: ${result.read} read, ${result.unchanged} unchanged (re-checked), ${result.removed} removed${result.unreadable ? `, ${result.unreadable} unreadable` : ''} · ${(result.ms / 1000).toFixed(1)} s`,
      )
      console.log(
        pc.dim(
          `Catalog: ${stats.sets} sets, ${stats.projects} projects, ${stats.plugins} plug-ins, ${stats.samples} samples (${catalogPath()})`,
        ),
      )
    }
    return 0
  } finally {
    await parser.close()
    catalog.db.close()
  }
}

export interface FindFlags {
  readonly sort?: string
  readonly limit?: string
  readonly json?: boolean
  readonly paths?: boolean
}

const home = homedir()
const short = (p: string) => (p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p)

function describe(s: FoundSet): string {
  const facts = [
    s.stage,
    s.seconds ? duration(s.seconds) : '',
    s.tempo ? `${Math.round(s.tempo * 100) / 100} BPM` : '',
    s.live ? `Live ${s.live}` : '',
  ].filter(Boolean)
  const missing = [
    s.missingSamples
      ? `${s.missingSamples} sample${s.missingSamples === 1 ? '' : 's'} missing`
      : '',
    s.missingPlugins
      ? `${s.missingPlugins} plug-in${s.missingPlugins === 1 ? '' : 's'} missing`
      : '',
    s.missingDevices
      ? `${s.missingDevices} Max device${s.missingDevices === 1 ? '' : 's'} missing`
      : '',
    s.rosettaPlugins ? `Rosetta ${s.rosettaPlugins}` : '',
    s.error ? s.error : '',
  ].filter(Boolean)
  return `${short(s.path)}  ${pc.dim(facts.join(' · '))}${missing.length ? `  ${pc.yellow(missing.join(', '))}` : ''}`
}

/** `livesaver find`: search the catalog. */
export async function runFind(words: string[], flags: FindFlags): Promise<number> {
  const catalog = await openCatalog(true)
  try {
    if (catalog.stats().sets === 0) {
      console.error('The catalog is empty: run `livesaver index <folders>` first.')
      return 1
    }
    const found = searchCatalog(catalog, words.join(' '), {
      ...(flags.sort ? { sort: flags.sort } : {}),
      ...(flags.limit ? { limit: Number(flags.limit) } : {}),
    })
    if (flags.json) console.log(JSON.stringify(found, null, 2))
    else if (flags.paths) for (const s of found) console.log(s.path)
    else {
      for (const s of found) console.log(describe(s))
      console.log(pc.dim(`${found.length} sets`))
    }
    return found.length ? 0 : 1
  } catch (error) {
    if (error instanceof QueryError) {
      console.error(error.message)
      return 2
    }
    throw error
  } finally {
    catalog.db.close()
  }
}

/** `livesaver sql`: a read-only SQL query against the catalog. */
export async function runSql(sql: string, flags: { json?: boolean }): Promise<number> {
  const catalog = await openCatalog(true)
  try {
    const rows = catalog.db.all(sql)
    if (flags.json)
      console.log(JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2))
    else if (rows.length) {
      const cols = Object.keys(rows[0] as object)
      console.log(pc.bold(cols.join('\t')))
      for (const r of rows) console.log(cols.map((c) => String(r[c] ?? '')).join('\t'))
    }
    return 0
  } catch (error) {
    console.error((error as Error).message)
    return 2
  } finally {
    catalog.db.close()
  }
}
