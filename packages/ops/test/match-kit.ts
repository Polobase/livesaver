/** What the tests of resolving and choosing share: a host, an environment, an index. */
import { EMPTY_REMAP } from '@livesaver/core'
import { createNodeHost } from '@livesaver/node'
import { type EnvConfig, Environment, FileIndex, Probe } from '../src/index.js'

export const host = createNodeHost()

export function env(
  config: Partial<EnvConfig> = {},
  probe = new Probe(host.fs, host.hash),
): Environment {
  return new Environment(
    {
      userLibrary: '',
      factoryPacks: '',
      appResources: '',
      preferredRoots: [],
      vendorLibraries: [],
      remap: EMPTY_REMAP,
      ...config,
    },
    probe,
  )
}

export async function index(roots: string[], ignore: string[] = []): Promise<FileIndex> {
  return FileIndex.build(roots, new Probe(host.fs, host.hash), { ignore })
}
