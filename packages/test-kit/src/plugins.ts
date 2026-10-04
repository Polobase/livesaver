/**
 * Plug-ins as they lie on a Mac, made up for tests: bundles in a plug-in folder with the first
 * bytes of their binaries, and Live's database of the plug-ins it scanned.
 */
import { Database } from 'bun:sqlite'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/** CPU types of a Mach-O binary. */
export const ARM64 = 0x0100000c
export const X86_64 = 0x01000007

/** The head of a binary for one processor, or of a universal one for several. */
export function machO(...cpus: number[]): Uint8Array {
  if (cpus.length === 1) {
    const thin = new Uint8Array(32)
    thin.set([0xcf, 0xfa, 0xed, 0xfe])
    new DataView(thin.buffer).setUint32(4, cpus[0] as number, true)
    return thin
  }
  const fat = new Uint8Array(8 + cpus.length * 20)
  const view = new DataView(fat.buffer)
  fat.set([0xca, 0xfe, 0xba, 0xbe])
  view.setUint32(4, cpus.length)
  for (const [i, cpu] of cpus.entries()) view.setUint32(8 + i * 20, cpu)
  return fat
}

type Plist = string | Plist[] | { [key: string]: Plist }

function xml(value: Plist, indent = ''): string {
  if (typeof value === 'string') return `${indent}<string>${value}</string>`
  if (Array.isArray(value))
    return `${indent}<array>\n${value.map((v) => xml(v, `${indent}\t`)).join('\n')}\n${indent}</array>`
  return `${indent}<dict>\n${Object.entries(value)
    .map(([key, v]) => `${indent}\t<key>${key}</key>\n${xml(v, `${indent}\t`)}`)
    .join('\n')}\n${indent}</dict>`
}

/**
 * A plug-in bundle (`.vst`, `.vst3`, `.component`): its `Info.plist` as Xcode writes it, and
 * its binary for the given processors. `files`: more files in it, by their path in the bundle.
 */
export function pluginBundle(
  path: string,
  cpus: readonly number[],
  info: { [key: string]: Plist } = {},
  files: Readonly<Record<string, string>> = {},
): string {
  const name = basename(path).replace(/\.[^.]+$/, '')
  const put = (inside: string, data: Uint8Array | string) => {
    const file = join(path, inside)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, data)
  }
  put(join('Contents', 'MacOS', name), machO(...cpus))
  put(
    join('Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${xml({ CFBundleExecutable: name, ...info })}\n</plist>\n`,
  )
  for (const [inside, content] of Object.entries(files)) put(inside, content)
  return path
}

/** A plug-in as Live's database has it: the bundle it scanned, for which processor, and its id. */
export interface ScannedPlugin {
  /** The bundle, by the path Live scanned it at. */
  readonly path: string
  /** 1 = Intel (Live under Rosetta), 2 = Apple Silicon. */
  readonly processor: 1 | 2
  /** e.g. `device:vst3:instr:56535458-6673-5873-6572-756d00000000`. */
  readonly devIdentifier: string
  readonly name: string
  /** 1 = scanned (the default); another value: Live could not load it. */
  readonly scanstate?: number
}

/**
 * Live's plug-in database (`Live-plugins-1.db`) in `folder`. `open`: as while Live runs, in WAL
 * mode with everything still in the log beside it; close it when the test is over.
 */
export function livePluginDatabase(
  folder: string,
  plugins: readonly ScannedPlugin[],
  open = false,
): { close(): void } {
  mkdirSync(folder, { recursive: true })
  const db = new Database(join(folder, 'Live-plugins-1.db'))
  if (open) {
    db.run('PRAGMA journal_mode = WAL')
    db.run('PRAGMA wal_autocheckpoint = 0')
  }
  db.run(`CREATE TABLE plugin_modules (module_id INTEGER PRIMARY KEY, path TEXT, arch INTEGER,
    processor INTEGER, scanstate INTEGER, fingerprint TEXT)`)
  db.run(`CREATE TABLE plugins (plugin_id INTEGER PRIMARY KEY AUTOINCREMENT, module_id INTEGER,
    dev_identifier TEXT, name TEXT, vendor TEXT, version TEXT, sdk_version TEXT, flags INTEGER,
    scanstate INTEGER, subcategories TEXT, enabled INTEGER)`)
  const modules = new Map<string, number>()
  for (const plugin of plugins) {
    const key = `${plugin.path}\u0000${plugin.processor}`
    let id = modules.get(key)
    if (id === undefined) {
      id = modules.size + 1
      modules.set(key, id)
      db.run('INSERT INTO plugin_modules VALUES (?, ?, ?, ?, ?, ?)', [
        id,
        plugin.path,
        plugin.path.endsWith('.vst3') ? 3 : 2,
        plugin.processor,
        plugin.scanstate ?? 1,
        '0:0',
      ])
    }
    if ((plugin.scanstate ?? 1) === 1)
      db.run(
        'INSERT INTO plugins (module_id, dev_identifier, name, vendor, enabled) VALUES (?, ?, ?, ?, 1)',
        [id, plugin.devIdentifier, plugin.name, 'Vendor'],
      )
  }
  if (!open) db.close()
  return { close: () => (open ? db.close() : undefined) }
}
