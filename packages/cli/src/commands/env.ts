import { findLiveInstalls, liveIsRunning, readLibraryConfig } from '@livesaver/node'
import pc from 'picocolors'
import { resolveConfig } from '../config.js'

export interface EnvFlags {
  readonly config?: string
  readonly json?: boolean
}

export async function runEnv(flags: EnvFlags): Promise<number> {
  const installs = await findLiveInstalls()
  const library = await readLibraryConfig(installs[0]?.version)
  const config = await resolveConfig({
    ...(flags.config ? { config: flags.config } : {}),
  })
  const env = config.env
  const data = {
    live: installs.map((i) => ({ app: i.app, version: i.version })),
    liveRunning: liveIsRunning(),
    libraryCfg: library?.preferences,
    packsInLibraryCfg: library?.packs.length ?? 0,
    config: config.sources,
    userLibrary: env.userLibrary,
    factoryPacks: env.factoryPacks,
    appResources: env.appResources,
    remapEntries: env.remap.mapping.size,
    preferredRoots: env.preferredRoots,
    vendorLibraries: env.vendorLibraries,
    searchRoots: config.searchRoots,
    packLimitBytes: config.packCopyLimit,
  }
  if (flags.json) {
    console.log(JSON.stringify(data, null, 2))
    return 0
  }
  const row = (k: string, v: unknown) =>
    console.log(`${pc.dim(k.padEnd(18))} ${Array.isArray(v) ? v.join('\n'.padEnd(20)) : String(v)}`)
  row(
    'Live',
    data.live.map((l) => `${l.version}  ${l.app}`),
  )
  row('Live running', data.liveRunning ? pc.yellow('yes') : 'no')
  row('Library.cfg', `${data.libraryCfg ?? '—'} (${data.packsInLibraryCfg} packs)`)
  row('config', data.config)
  row('User Library', data.userLibrary)
  row('Factory Packs', data.factoryPacks)
  row('App-Resources', `${data.appResources} (${data.remapEntries} remap entries)`)
  row('preferred roots', data.preferredRoots)
  row('vendor libraries', data.vendorLibraries)
  row('search roots', data.searchRoots)
  row('pack limit', `${(data.packLimitBytes / 1e6).toFixed(0)} MB`)
  return 0
}
