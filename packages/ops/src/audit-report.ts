/** Report files and console summary of `plugins audit`. */
import { compareCodePoints, type PluginRef, pluginCode, posix } from '@livesaver/core'
import type { Alternative, Inventory } from '@livesaver/plugins'
import {
  type AuditResult,
  type InstalledProduct,
  installedProducts,
  nativeAlternative,
  type PluginUse,
  type UninstallImpact,
} from './audit.js'
import { formatSheet } from './sheet.js'

/** Report file names of `plugins audit`. */
export const AUDIT_FILES = {
  used: 'plugins-used.csv',
  installed: 'plugins-installed.csv',
  overview: 'plugins-audit.md',
} as const

const STATES = { installed: 'installed', rosetta: 'Rosetta only', missing: 'missing' } as const

const USED_COLUMNS = [
  'Plugin',
  'Format',
  'ID',
  'Status',
  'Instances',
  'Sets',
  'Projects',
  'Installed at',
  'Native alternative',
  'Other formats installed',
  'VST3 for upgrade',
  'Upgrade',
  'Note',
  'Project list',
]

const INSTALLED_COLUMNS = [
  'Plugin',
  'Format',
  'ID',
  'Native',
  'Scanned by Live',
  'Used',
  'Version',
  'Path',
]

const rel = (path: string, base: string) => {
  const r = posix.relpath(path, base)
  return r === '.' ? posix.basename(path) : r
}

function altText(a: Alternative): string {
  return `${a.name} (${a.format}, ${a.native ? 'native' : 'Intel'}, ${a.link})`
}

const refText = (r: PluginRef) => `${r.name} (${r.format})`

/** The report files: name → content. */
export function auditReports(audit: AuditResult, inventory: Inventory): Map<string, string> {
  const files = new Map<string, string>()
  const usedRows = audit.uses.map((u) => {
    const native = nativeAlternative(u)
    return [
      u.ref.name,
      u.ref.format,
      pluginCode(u.ref),
      STATES[u.state],
      u.instances,
      u.sets.size,
      u.projects.size,
      [...new Set(u.found.map((e) => e.path).filter((p) => p))].sort(compareCodePoints).join(' | '),
      u.state !== 'installed' && native ? altText(native) : '',
      u.alternatives.map(altText).join(' | '),
      u.vst3 ? `${u.vst3.name} (${u.vst3.uid})` : '',
      u.vst3 ? (u.vst3.verified ? 'verified: livesaver plugins upgrade' : 'not verified') : '',
      u.failedBundle ? `bundle present, but Live could not load it: ${u.failedBundle}` : '',
      [...u.projects]
        .map((p) => rel(p, audit.base))
        .sort(compareCodePoints)
        .join(' | '),
    ]
  })
  files.set(AUDIT_FILES.used, formatSheet(USED_COLUMNS, usedRows))
  const usedKeys = new Map<string, number>()
  for (const u of audit.uses) {
    const k = `${u.ref.format}\u0000${u.ref.ident}`
    usedKeys.set(k, (usedKeys.get(k) ?? 0) + u.sets.size)
  }
  const installedRows = installedProducts(inventory).map((p: InstalledProduct) => [
    p.name,
    p.format,
    p.format === 'VST2' ? pluginCode({ format: 'VST2', ident: p.ident, name: p.name }) : p.ident,
    p.native ? 'yes' : 'no',
    p.scanned ? 'yes' : 'no',
    usedKeys.get(`${p.format}\u0000${p.ident}`) ?? 0,
    p.paths.map((x) => inventory.bundles.get(x)?.version ?? '').find((v) => v) ?? '',
    p.paths.join(' | '),
  ])
  files.set(AUDIT_FILES.installed, formatSheet(INSTALLED_COLUMNS, installedRows))
  files.set(AUDIT_FILES.overview, auditOverview(audit))
  return files
}

function table(header: string, rows: readonly string[]): string[] {
  return rows.length ? [header, `|${'---|'.repeat(header.split('|').length - 2)}`, ...rows] : []
}

function auditOverview(audit: AuditResult): string {
  const missing = audit.uses.filter((u) => u.state === 'missing')
  const rosetta = audit.uses.filter((u) => u.state === 'rosetta')
  const fixable = audit.uses.filter((u) => u.state !== 'installed' && nativeAlternative(u))
  const upgrades = audit.uses.filter((u) => u.vst3)
  const projects = (u: PluginUse) => u.projects.size
  const md = [
    '# Plug-in audit',
    '',
    `Folder: \`${audit.base}\` · ${audit.sets} sets · ${audit.projects} projects`,
    '',
    '| | Plug-ins |',
    '|---|---:|',
    `| used | ${audit.uses.length} |`,
    `| missing | ${missing.length} |`,
    `| Rosetta only | ${rosetta.length} |`,
    `| of these, installed natively in another format | ${fixable.length} |`,
    `| VST2 with the VST3 installed | ${upgrades.length} |`,
    `| installed, used by no set | ${audit.unused.length} |`,
  ]
  const section = (title: string, rows: string[]) => {
    if (rows.length) md.push('', `## ${title}`, '', ...rows)
  }
  section(
    'Missing plug-ins',
    table(
      '| Plugin | Format | Projects | Sets | installed in another format |',
      missing.map(
        (u) =>
          `| ${u.ref.name} | ${u.ref.format} | ${projects(u)} | ${u.sets.size} | ${u.alternatives
            .filter((a) => a.link !== 'name')
            .map((a) => `${a.format}${a.native ? '' : ' (Intel)'}`)
            .join(', ')} |`,
      ),
    ),
  )
  section(
    'Plug-ins only with Rosetta',
    table(
      '| Plugin | Format | Projects | native alternative |',
      rosetta.map((u) => {
        const n = nativeAlternative(u)
        return `| ${u.ref.name} | ${u.ref.format} | ${projects(u)} | ${n ? `${n.name} (${n.format})` : '–'} |`
      }),
    ),
  )
  section(
    'VST2 → VST3',
    table(
      '| Plugin | VST3 | Projects | Upgrade |',
      upgrades.map(
        (u) =>
          `| ${u.ref.name} | ${u.vst3?.name} | ${projects(u)} | ${u.vst3?.verified ? '`livesaver plugins upgrade`' : 'not verified yet'} |`,
      ),
    ),
  )
  section(
    'Installed but unused',
    audit.unused.map((p) => `- ${p.name || p.ident} (${p.format}${p.native ? '' : ', Intel'})`),
  )
  if (audit.unreadable.length)
    section(
      'Unreadable sets',
      audit.unreadable.map((s) => `- ${rel(s, audit.base)}`),
    )
  md.push('')
  return md.join('\n')
}

/** The console summary. */
export function auditSummary(audit: AuditResult): string {
  const count = (f: (u: PluginUse) => boolean) => audit.uses.filter(f).length
  const lines = [
    `${audit.sets} sets in ${audit.projects} projects use ${audit.uses.length} plug-ins.`,
    `Missing: ${count((u) => u.state === 'missing')}   Rosetta only: ${count((u) => u.state === 'rosetta')}   VST3 available: ${count((u) => Boolean(u.vst3))}   Installed, unused: ${audit.unused.length}`,
  ]
  for (const u of audit.uses.filter((x) => x.state !== 'installed').slice(0, 15)) {
    const n = nativeAlternative(u)
    lines.push(
      `  ${u.state === 'missing' ? 'missing' : 'Rosetta'}  ${refText(u.ref)} · ${u.projects.size} projects${n ? ` → installed natively: ${n.name} (${n.format})` : ''}`,
    )
  }
  return lines.join('\n')
}

export function uninstallText(impact: UninstallImpact, name: string, base: string): string {
  if (!impact.removes.length) return `No installed plug-in is called “${name}”.`
  const lines = [
    `Uninstalling: ${impact.removes.map((p) => `${p.name || p.ident} (${p.format})`).join(', ')}`,
  ]
  if (!impact.breaks.length) {
    lines.push('No set loses a plug-in by this.')
    return lines.join('\n')
  }
  lines.push(
    `Afterwards ${impact.sets.length} sets (${impact.projects.length} projects) miss: ${impact.breaks.map((u) => refText(u.ref)).join(', ')}`,
  )
  lines.push(...impact.projects.map((p) => `  ${rel(p, base)}`))
  return lines.join('\n')
}
