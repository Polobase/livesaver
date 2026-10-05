/** What the tests of `collect --apply` share: a temporary folder per test, and a run in it. */
import { afterEach, beforeEach } from 'bun:test'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { EMPTY_REMAP, fileRefs, type Host } from '@livesaver/core'
import { createNodeHost } from '@livesaver/node'
import { docFromText, readSet, tempDir } from '@livesaver/test-kit'
import {
  applyWriter,
  buildReports,
  DEFAULT_PACK_LIMIT,
  type DoctorResult,
  doctor,
  type EnvConfig,
  Probe,
} from '../src/index.js'

export function env(config: Partial<EnvConfig> = {}): EnvConfig {
  return {
    userLibrary: '',
    factoryPacks: '',
    appResources: '',
    preferredRoots: [],
    vendorLibraries: [],
    remap: EMPTY_REMAP,
    ...config,
  }
}

export interface Run extends DoctorResult {
  readonly reports: Record<string, string>
}

export interface RunOptions {
  env?: Partial<EnvConfig>
  apply?: boolean
  packLimit?: number
  matchLibraryPath?: boolean
  /** Sets saved by a Live older than this major version are left out. */
  minLive?: number
  /** Another host than Node's as it is (one that sees or makes less). */
  host?: Host
}

/** Call at the top of a test file: its tests get a temporary folder each, and runs in it. */
export function useCollect() {
  const tmp = { path: '' }
  let cleanup = () => {}
  let runs = 0
  beforeEach(() => {
    const made = tempDir()
    tmp.path = made.path
    cleanup = made.cleanup
  })
  afterEach(() => cleanup())

  async function run(targets: string[], search: string[], options: RunOptions = {}): Promise<Run> {
    const host = options.host ?? createNodeHost({ write: true })
    const probe = new Probe(host.fs, host.hash)
    const context = { id: `test-${++runs}`, dir: join(tmp.path, `run-${runs}`) }
    const result = await doctor(host, {
      targets,
      searchRoots: search,
      env: env(options.env),
      packCopyLimit: options.packLimit ?? DEFAULT_PACK_LIMIT,
      matchLibraryPath: options.matchLibraryPath ?? false,
      minLive: options.minLive ?? 0,
      probe,
      ...(options.apply ? { writer: applyWriter(host, context, probe) } : {}),
    })
    return { ...result, reports: await buildReports(result.results, result.base, probe) }
  }

  return { tmp, run }
}

/** Rows of a generated CSV as objects (BOM, CRLF, minimal quoting). */
export function csv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const s = text.replace(/^\ufeff/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\r' && s[i + 1] === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
    } else field += c
  }
  const [head = [], ...body] = rows
  return body.map((r) => Object.fromEntries(head.map((h, k) => [h, r[k] ?? ''])))
}

export const mtimeUs = (p: string) =>
  Math.round(Number(statSync(p, { bigint: true }).mtimeNs) / 1000)
export const refsOf = async (path: string) => fileRefs(await docFromText(readSet(path)))
