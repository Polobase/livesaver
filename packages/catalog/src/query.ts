/**
 * The `find` language: words search names, projects, plug-ins, samples and locators; `field:value`
 * terms filter; `-` negates a term; quotes keep spaces. Examples:
 *
 *   plugin:serum bpm:120..128 stage:arranged missing:samples
 *   "night drive" -stage:empty live:12 length:>3:00 modified:2024
 *
 * Numbers take `a..b`, `>a`, `>=a`, `<a`, `<=a` or an exact value; lengths `m:ss`, `h:mm:ss` or
 * seconds; dates `YYYY`, `YYYY-MM` or `YYYY-MM-DD`.
 */
import { norm, type SqlValue } from '@livesaver/core'

export class QueryError extends Error {
  override name = 'QueryError'
}

export interface CompiledQuery {
  /** SQL condition on `sets s` (`1` when empty). */
  readonly where: string
  readonly params: SqlValue[]
}

/** Stage names (keys and names of the default profile) → stored stage. */
const STAGES: Record<string, string> = {
  empty: 'empty',
  session: 'session',
  sessiononly: 'session',
  sketch: 'sketch',
  arranged: 'arranged',
  elaborated: 'elaborated',
  error: 'error',
  unreadable: 'error',
}

/** Numeric fields: query name → SQL expression. */
const NUMBERS: Record<string, string> = {
  bpm: 's.tempo',
  tempo: 's.tempo',
  bars: 's.bars',
  tracks: 's.tracks',
  audio: 's.audio_tracks',
  midi: 's.midi_tracks',
  returns: 's.return_tracks',
  clips: '(s.arrangement_clips + s.session_clips)',
  scenes: 's.scenes_used',
  automation: 's.automated',
  automated: 's.automated',
  blocks: 's.distinct_blocks',
  locators: 'json_array_length(s.locators)',
  size: 's.size',
  plugins: '(SELECT count(*) FROM set_plugins p WHERE p.set_id = s.id)',
  samples:
    "(SELECT count(*) FROM set_refs l JOIN refs r ON r.id = l.ref_id WHERE l.set_id = s.id AND r.kind = 'sample')",
}

/** Split a query into terms, keeping quoted parts together. */
export function tokenize(text: string): string[] {
  const out: string[] = []
  const re = /(-?)(?:([\w-]+):)?(?:"([^"]*)"|(\S+))/gu
  for (const m of text.matchAll(re)) {
    const [, neg = '', field, quoted, plain] = m
    const value = quoted ?? plain ?? ''
    out.push(`${neg}${field ? `${field}:` : ''}${quoted !== undefined ? `"${value}"` : value}`)
  }
  return out
}

function unquote(v: string): string {
  return v.startsWith('"') && v.endsWith('"') && v.length >= 2 ? v.slice(1, -1) : v
}

const likeEscape = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`)
const like = (v: string) => `%${likeEscape(norm(v))}%`

function parseNumber(v: string, field: string): number {
  const n = Number(v)
  if (!Number.isFinite(n)) throw new QueryError(`${field}: “${v}” is no number`)
  return n
}

/** Seconds of "3:12", "1:02:03", "192" or "4m". */
export function parseDuration(v: string): number {
  if (/^\d+(?:\.\d+)?m$/.test(v)) return Number(v.slice(0, -1)) * 60
  const parts = v.split(':')
  if (parts.some((p) => !/^\d+(?:\.\d+)?$/.test(p)) || parts.length > 3)
    throw new QueryError(`length: “${v}” is no duration (m:ss)`)
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0)
}

/** [from, to) in seconds since 1970 for "2024", "2024-05" or "2024-05-01" (local time). */
export function parseDate(v: string): [number, number] {
  const m = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(v)
  if (!m) throw new QueryError(`modified: “${v}” is no date (YYYY, YYYY-MM or YYYY-MM-DD)`)
  const y = Number(m[1])
  const mo = m[2] ? Number(m[2]) - 1 : undefined
  const d = m[3] ? Number(m[3]) : undefined
  const from = new Date(y, mo ?? 0, d ?? 1)
  const to =
    d !== undefined
      ? new Date(y, mo as number, d + 1)
      : mo !== undefined
        ? new Date(y, mo + 1, 1)
        : new Date(y + 1, 0, 1)
  return [from.getTime() / 1000, to.getTime() / 1000]
}

/** A range condition on `expr` for "a..b", ">a", ">=a", "<a", "<=a", "a". */
function range(
  expr: string,
  raw: string,
  parse: (v: string) => number,
  exact: (n: number) => [string, SqlValue[]] = (n) => [`${expr} = ?`, [n]],
): [string, SqlValue[]] {
  const between = /^(.*)\.\.(.*)$/.exec(raw)
  if (between) {
    const [, a = '', b = ''] = between
    const parts: string[] = []
    const params: SqlValue[] = []
    if (a) {
      parts.push(`${expr} >= ?`)
      params.push(parse(a))
    }
    if (b) {
      parts.push(`${expr} <= ?`)
      params.push(parse(b))
    }
    if (!parts.length) throw new QueryError(`“${raw}” is no range`)
    return [parts.join(' AND '), params]
  }
  const cmp = /^(>=|<=|>|<|=)(.+)$/.exec(raw)
  if (cmp) {
    const [, op, v = ''] = cmp
    return op === '=' ? exact(parse(v)) : [`${expr} ${op} ?`, [parse(v)]]
  }
  return exact(parse(raw))
}

function yesNo(v: string, field: string): boolean {
  const t = v.toLowerCase()
  if (['yes', 'true', '1', 'y'].includes(t)) return true
  if (['no', 'false', '0', 'n'].includes(t)) return false
  throw new QueryError(`${field}: “${v}” (yes or no)`)
}

/** One `field:value` term → SQL condition and parameters. */
function term(field: string, raw: string): [string, SqlValue[]] {
  const v = unquote(raw)
  const f = field.toLowerCase()
  if (f in NUMBERS) {
    const expr = NUMBERS[f] as string
    // A whole-number tempo matches 120 and 120.0 but also 119.995…120.005 (sets store floats).
    const exact =
      f === 'bpm' || f === 'tempo'
        ? (n: number): [string, SqlValue[]] => [
            `${expr} >= ? AND ${expr} < ?`,
            [n - 0.005, n + 0.005],
          ]
        : undefined
    return range(expr, v, (x) => parseNumber(x, f), exact)
  }
  switch (f) {
    case 'length':
    case 'duration':
      return range('s.seconds', v, parseDuration, (n) => [
        's.seconds >= ? AND s.seconds < ?',
        [n, n + 1],
      ])
    case 'modified':
    case 'date': {
      const cmp = /^(>=|<=|>|<)(.+)$/.exec(v)
      if (cmp) {
        const [from, to] = parseDate(cmp[2] as string)
        const op = cmp[1] as string
        return op === '>'
          ? ['s.mtime >= ?', [to]]
          : op === '>='
            ? ['s.mtime >= ?', [from]]
            : op === '<'
              ? ['s.mtime < ?', [from]]
              : ['s.mtime < ?', [to]]
      }
      const between = /^(.*)\.\.(.*)$/.exec(v)
      if (between) {
        const parts: string[] = []
        const params: SqlValue[] = []
        if (between[1]) {
          parts.push('s.mtime >= ?')
          params.push(parseDate(between[1])[0])
        }
        if (between[2]) {
          parts.push('s.mtime < ?')
          params.push(parseDate(between[2])[1])
        }
        return [parts.join(' AND ') || '1', params]
      }
      const [from, to] = parseDate(v)
      return ['s.mtime >= ? AND s.mtime < ?', [from, to]]
    }
    case 'stage': {
      const stage = STAGES[v.toLowerCase().replace(/[\s_-]/g, '')]
      if (!stage)
        throw new QueryError(`stage: “${v}” (empty, session, sketch, arranged, elaborated, error)`)
      return ['s.stage = ?', [stage]]
    }
    case 'live':
    case 'version':
      return /^\d+$/.test(v)
        ? ['s.major = ?', [Number(v)]]
        : ["s.live = ? OR s.live LIKE ? ESCAPE '\\'", [v, `${likeEscape(v)}.%`]]
    case 'plugin':
      return [
        "EXISTS (SELECT 1 FROM set_plugins p WHERE p.set_id = s.id AND (p.name_key LIKE ? ESCAPE '\\' OR p.ident = ?))",
        [like(v), v.toLowerCase()],
      ]
    case 'format': {
      const format = v.toUpperCase().replace(/^VST$/, 'VST2')
      if (!['VST2', 'VST3', 'AU'].includes(format))
        throw new QueryError(`format: “${v}” (vst2, vst3, au)`)
      return [
        'EXISTS (SELECT 1 FROM set_plugins p WHERE p.set_id = s.id AND p.format = ?)',
        [format],
      ]
    }
    case 'sample':
    case 'file':
      return [
        "EXISTS (SELECT 1 FROM set_refs l JOIN refs r ON r.id = l.ref_id WHERE l.set_id = s.id AND r.name_key LIKE ? ESCAPE '\\')",
        [like(v)],
      ]
    case 'device':
      return [
        "EXISTS (SELECT 1 FROM set_refs l JOIN refs r ON r.id = l.ref_id WHERE l.set_id = s.id AND r.kind = 'device' AND r.name_key LIKE ? ESCAPE '\\')",
        [like(v)],
      ]
    case 'missing': {
      const what = v.toLowerCase()
      if (['sample', 'samples'].includes(what)) return ['s.missing_samples > 0', []]
      if (['plugin', 'plugins'].includes(what)) return ['s.missing_plugins > 0', []]
      if (['device', 'devices', 'max'].includes(what)) return ['s.missing_devices > 0', []]
      if (['any', 'yes', 'anything'].includes(what))
        return ['(s.missing_samples + s.missing_devices + s.missing_plugins) > 0', []]
      if (['none', 'no', 'nothing'].includes(what))
        return ['(s.missing_samples + s.missing_devices + s.missing_plugins) = 0', []]
      throw new QueryError(`missing: “${v}” (samples, plugins, devices, any, none)`)
    }
    case 'rosetta':
      return [yesNo(v, f) ? 's.rosetta_plugins > 0' : 's.rosetta_plugins = 0', []]
    case 'complete': {
      const c =
        "s.error = '' AND (s.missing_samples + s.missing_devices + s.missing_plugins + s.rosetta_plugins) = 0"
      return [yesNo(v, f) ? c : `NOT (${c})`, []]
    }
    case 'error':
    case 'unreadable':
      return [yesNo(v, f) ? "s.error <> ''" : "s.error = ''", []]
    case 'project':
      return ["s.project_key LIKE ? ESCAPE '\\'", [`%${likeEscape(norm(v))}%`]]
    case 'path':
    case 'in':
      return ["s.path_key LIKE ? ESCAPE '\\'", [like(v)]]
    case 'name':
      return ["s.name_key LIKE ? ESCAPE '\\'", [like(v)]]
    case 'has': {
      const what = v.toLowerCase()
      if (what === 'arrangement') return ['s.arrangement_clips > 0', []]
      if (what === 'session') return ['s.session_clips > 0', []]
      if (what === 'automation') return ['s.automated > 0', []]
      if (what === 'locators') return ["s.locators <> '[]'", []]
      throw new QueryError(`has: “${v}” (arrangement, session, automation, locators)`)
    }
    case 'duplicate':
    case 'copies':
      return [
        `${yesNo(v, f) ? '' : 'NOT '}EXISTS (SELECT 1 FROM sets o WHERE o.content_hash = s.content_hash AND o.id <> s.id AND s.content_hash <> '')`,
        [],
      ]
    default:
      throw new QueryError(`unknown field “${field}”`)
  }
}

/** Free words as an FTS5 query: every word must occur, as a word prefix. */
function ftsQuery(words: readonly string[]): string {
  return words.map((w) => `"${unquote(w).replaceAll('"', '""')}"*`).join(' ')
}

/** Compile a `find` query into a condition on `sets s`. */
export function compileQuery(text: string): CompiledQuery {
  const parts: string[] = []
  const params: SqlValue[] = []
  const words: string[] = []
  const notWords: string[] = []
  for (const token of tokenize(text)) {
    const negated = token.startsWith('-') && token.length > 1
    const body = negated ? token.slice(1) : token
    const field = /^([\w-]+):(.*)$/su.exec(body)
    if (field && !body.startsWith('"')) {
      const [sql, p] = term(field[1] as string, field[2] as string)
      parts.push(negated ? `NOT (${sql})` : `(${sql})`)
      params.push(...p)
    } else if (unquote(body)) (negated ? notWords : words).push(body)
  }
  if (words.length) {
    parts.push('s.id IN (SELECT rowid FROM sets_fts WHERE sets_fts MATCH ?)')
    params.push(ftsQuery(words))
  }
  for (const w of notWords) {
    parts.push('s.id NOT IN (SELECT rowid FROM sets_fts WHERE sets_fts MATCH ?)')
    params.push(ftsQuery([w]))
  }
  return { where: parts.length ? parts.join(' AND ') : '1', params }
}

export const SORTS: Record<string, string> = {
  path: 's.path_key',
  name: 's.name_key',
  project: 's.project_key, s.name_key',
  modified: 's.mtime DESC',
  length: 's.seconds DESC',
  bpm: 's.tempo',
  stage:
    "CASE s.stage WHEN 'elaborated' THEN 0 WHEN 'arranged' THEN 1 WHEN 'sketch' THEN 2 WHEN 'session' THEN 3 WHEN 'empty' THEN 4 ELSE 5 END, s.seconds DESC",
}
