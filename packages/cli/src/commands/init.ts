import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import pc from 'picocolors'
import { CONFIG_PATH, type FileConfig, resolveConfig } from '../config.js'
import { dirname } from '../paths.js'

export interface InitFlags {
  readonly force?: boolean
}

/** Write ~/.config/livesaver/config.json from the detected Live setup. */
export async function runInit(flags: InitFlags): Promise<number> {
  if (existsSync(CONFIG_PATH) && !flags.force) {
    console.error(`${CONFIG_PATH} exists; use --force to replace it`)
    return 1
  }
  const resolved = await resolveConfig({})
  const config: FileConfig = {
    userLibrary: resolved.env.userLibrary,
    factoryPacks: resolved.env.factoryPacks,
    preferredRoots: [...resolved.env.preferredRoots],
    vendorLibraries: [...resolved.env.vendorLibraries],
    searchRoots: [...resolved.searchRoots],
    packLimitMB: resolved.packCopyLimit / 1_000_000,
  }
  mkdirSync(dirname(CONFIG_PATH), { recursive: true })
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`)
  console.log(`${pc.green('wrote')} ${CONFIG_PATH}`)
  console.log(pc.dim('Edit searchRoots/preferredRoots there; `livesaver env` shows the result.'))
  return 0
}
