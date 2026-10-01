/**
 * Where Ableton content lives (User Library, packs, the Live app), and questions about paths that
 * depend on it.
 */
import {
  CORE_LIBRARY_PACK_ID,
  MAX_REMAP_STEPS,
  norm,
  parsePackProperties,
  posix,
  REL_BUILTIN,
  REL_PACK,
  type RemapTable,
  remapKey,
} from '@livesaver/core'
import { decodeUtf8 } from '@livesaver/xml'
import type { Probe } from './probe.js'

export interface EnvConfig {
  readonly userLibrary: string
  readonly factoryPacks: string
  /** `<Live.app>/Contents/App-Resources` of the installed Live ('' if none). */
  readonly appResources: string
  /** Tie-break order after the set's own project. */
  readonly preferredRoots: readonly string[]
  /** Commercial libraries whose files vendors re-saved (e.g. /Users/Shared for NI content). */
  readonly vendorLibraries: readonly string[]
  readonly remap: RemapTable
}

const keyCache = new Map<string, string>()

function pathKey(path: string): string {
  let key = keyCache.get(path)
  if (key === undefined) {
    key = norm(posix.normpath(path))
    if (keyCache.size > 500_000) keyCache.clear()
    keyCache.set(path, key)
  }
  return key
}

/** Whether `path` is `root` or lies below it, compared like macOS does (case/normalization-insensitive). */
export function isInside(path: string, root: string): boolean {
  const p = pathKey(path)
  const r = pathKey(root)
  return p === r || p.startsWith(`${r.replace(/\/+$/, '')}/`)
}

/** `posix.join(base, ...parts)`, or '' when `base` is empty (no location configured). */
export function joinIf(base: string, ...parts: string[]): string {
  return base ? posix.join(base, ...parts) : ''
}

export interface PackLocation {
  readonly root: string
  readonly name: string
  readonly id: string
}

export class Environment {
  readonly config: EnvConfig
  readonly coreLibrary: string
  readonly builtin: string
  private readonly probe: Probe
  private readonly props = new Map<string, Promise<{ name: string; id: string }>>()

  constructor(config: EnvConfig, probe: Probe) {
    this.config = config
    this.probe = probe
    this.coreLibrary = joinIf(config.appResources, 'Core Library')
    this.builtin = joinIf(config.appResources, 'Builtin')
  }

  get userLibrary(): string {
    return this.config.userLibrary
  }

  get factoryPacks(): string {
    return this.config.factoryPacks
  }

  get appResources(): string {
    return this.config.appResources
  }

  /** File of an installed Ableton pack or the Core Library. */
  isPackFile(path: string): boolean {
    return [this.coreLibrary, this.config.factoryPacks].some((root) => root && isInside(path, root))
  }

  /** File of a commercial library (Ableton packs, Core Library, vendor libraries). */
  isVendorFile(path: string): boolean {
    return [this.config.factoryPacks, this.coreLibrary, ...this.config.vendorLibraries].some(
      (root) => root && isInside(path, root),
    )
  }

  /** The installed pack (or Core Library) a file belongs to, with its LivePackName and LivePackId. */
  async packOf(path: string): Promise<PackLocation | undefined> {
    if (this.coreLibrary && isInside(path, this.coreLibrary)) {
      return { root: this.coreLibrary, name: 'Core Library', id: CORE_LIBRARY_PACK_ID }
    }
    const packs = this.config.factoryPacks
    if (packs && isInside(path, packs)) {
      const root = posix.join(packs, posix.relpath(path, packs).split('/')[0] as string)
      const { name, id } = await this.packProperties(root)
      return id ? { root, name, id } : undefined
    }
    return undefined
  }

  private packProperties(root: string): Promise<{ name: string; id: string }> {
    let p = this.props.get(root)
    if (!p) {
      p = (async () => {
        const file = posix.join(root, 'Ableton Folder Info', 'Properties.cfg')
        try {
          const props = parsePackProperties(decodeUtf8(await this.probe.fs.readFile(file)))
          return { name: props.name ?? posix.basename(root), id: props.id ?? '' }
        } catch {
          return { name: posix.basename(root), id: '' }
        }
      })()
      this.props.set(root, p)
    }
    return p
  }

  /** Where Live's remap table says a moved library file is now ('' if it has no entry). */
  remapped(relType: number, packId: string, relPath: string): string {
    const { mapping, packNames } = this.config.remap
    let key = remapKey(relType, packId, relPath)
    let target: readonly [number, string, string] | undefined
    for (let step = 0; step < MAX_REMAP_STEPS; step++) {
      const next = mapping.get(key)
      if (!next) break
      target = next
      key = remapKey(next[0], next[1], next[2])
    }
    if (!target) return ''
    const [dstType, dstPack, dstRef] = target
    if (dstType === REL_BUILTIN) return joinIf(this.builtin, dstRef)
    if (dstType === REL_PACK && dstPack === CORE_LIBRARY_PACK_ID)
      return joinIf(this.coreLibrary, dstRef)
    const packName = packNames.get(dstPack)
    if (dstType === REL_PACK && packName !== undefined)
      return joinIf(this.config.factoryPacks, packName, dstRef)
    return ''
  }
}
