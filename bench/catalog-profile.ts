/** Where a warm `livesaver index` spends its time (read-only on the library; catalog in a temp copy). */
import { copyFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Catalog } from '../packages/catalog/src/index.ts'
import { posix } from '../packages/core/src/index.ts'
import { createNodeHost, openDatabase } from '../packages/node/src/index.ts'
import {
  Environment,
  findSets,
  Probe,
  projectRootOf,
  resolveExisting,
} from '../packages/ops/src/index.ts'

const [source, ...targets] = process.argv.slice(2) as [string, ...string[]]
const copy = join(mkdtempSync(join(tmpdir(), 'cat-')), 'c.sqlite')
copyFileSync(source, copy)
const catalog = new Catalog(await openDatabase(copy))
const host = createNodeHost()
const probe = new Probe(host.fs, host.hash)
const env = new Environment(
  {
    userLibrary: '',
    factoryPacks: '',
    appResources: '',
    preferredRoots: [],
    vendorLibraries: [],
    remap: { mapping: new Map(), packNames: new Map() },
  },
  probe,
)
let t = performance.now()
const lap = (label: string) => {
  const n = performance.now()
  console.log(label, ((n - t) / 1000).toFixed(2), 's')
  t = n
}
const sets = await findSets(targets, [], probe)
lap(`findSets (${sets.length})`)
const stored = catalog.identities(targets)
lap('identities')
let refs = 0
const all = []
for (const path of sets) {
  const id = stored.get(path)?.id
  if (id === undefined) continue
  const r = catalog.refs(id)
  refs += r.length
  all.push([path, r] as const)
}
lap(`load refs (${refs})`)
for (const [path, rs] of all) {
  const root = await projectRootOf(path, probe)
  for (const r of rs)
    r.resolved = (await resolveExisting(r, posix.dirname(path), root, env, probe)) ?? ''
}
lap('resolve')
catalog.transaction(() => {
  for (const [path, rs] of all)
    catalog.refresh(
      (stored.get(path) as { id: number }).id,
      rs,
      catalog.plugins((stored.get(path) as { id: number }).id),
    )
})
lap('write refresh')
