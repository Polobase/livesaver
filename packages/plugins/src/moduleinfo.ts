/**
 * `moduleinfo.json` of a VST3 bundle (VST3 SDK 3.7.5+): the classes a bundle provides and the
 * compatibility it declares ("this class replaces these older class ids", e.g. a VST2 version).
 * The file is JSON5 in practice (trailing commas), so it is cleaned up before `JSON.parse`.
 */

export interface ModuleClass {
  /** Class id, 32 lower-case hex digits. */
  readonly cid: string
  readonly name: string
  /** e.g. "Audio Module Class". */
  readonly category: string
  /** e.g. ["Fx", "Delay"]. */
  readonly subCategories: readonly string[]
  readonly vendor: string
  readonly version: string
}

export interface ModuleInfo {
  readonly name: string
  readonly version: string
  readonly vendor: string
  readonly classes: readonly ModuleClass[]
  /** New class id → the class ids it replaces (all lower-case). */
  readonly compatibility: ReadonlyMap<string, readonly string[]>
}

/** JSON5 → JSON for what moduleinfo files use: comments and trailing commas. */
function json5ToJson(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i] as string
    if (c === '"' || c === "'") {
      // copy a string literal (single-quoted ones become double-quoted)
      let j = i + 1
      let body = ''
      while (j < text.length && text[j] !== c) {
        if (text[j] === '\\') {
          body += text.slice(j, j + 2)
          j += 2
        } else {
          body += c === "'" && text[j] === '"' ? '\\"' : text[j]
          j++
        }
      }
      out += `"${body}"`
      i = j + 1
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? text.length : end + 2
    } else {
      out += c
      i++
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

const hexId = (v: unknown) =>
  typeof v === 'string' ? v.replace(/[^0-9a-fA-F]/g, '').toLowerCase() : ''
const str = (v: unknown) =>
  typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v)

/** Parse a moduleinfo.json text; `undefined` if it cannot be read as JSON5. */
export function parseModuleInfo(text: string): ModuleInfo | undefined {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(json5ToJson(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)) as Record<
      string,
      unknown
    >
  } catch {
    return undefined
  }
  if (typeof data !== 'object' || data === null) return undefined
  const factory = (data['Factory Info'] ?? {}) as Record<string, unknown>
  const classes: ModuleClass[] = []
  for (const c of Array.isArray(data.Classes) ? data.Classes : []) {
    const k = c as Record<string, unknown>
    const cid = hexId(k.CID)
    if (cid.length !== 32) continue
    classes.push({
      cid,
      name: str(k.Name),
      category: str(k.Category),
      subCategories: Array.isArray(k['Sub Categories']) ? k['Sub Categories'].map(str) : [],
      vendor: str(k.Vendor) || str(factory.Vendor),
      version: str(k.Version),
    })
  }
  const compatibility = new Map<string, string[]>()
  for (const entry of Array.isArray(data.Compatibility) ? data.Compatibility : []) {
    const e = entry as Record<string, unknown>
    const next = hexId(e.New)
    const old = (Array.isArray(e.Old) ? e.Old : []).map(hexId).filter((x) => x.length === 32)
    if (next.length === 32 && old.length) compatibility.set(next, old)
  }
  return {
    name: str(data.Name),
    version: str(data.Version),
    vendor: str(factory.Vendor),
    classes,
    compatibility,
  }
}
