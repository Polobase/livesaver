/**
 * Reserve the npm names with 0.0.0 placeholder packages.
 *
 *   bun scripts/reserve-npm-names.ts             # prepare placeholders in a temp folder, print commands
 *   bun scripts/reserve-npm-names.ts --publish   # also publish them (needs `npm login`; run it yourself)
 *
 * Before publishing the scoped names, create the npm organization "livesaver" on npmjs.com
 * (Add Organization → livesaver, free plan for public packages).
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const NAMES: Record<string, string> = {
  livesaver:
    'Keep your Ableton Live projects alive: relink missing samples, batch Collect All and Save, upgrade VST2 to VST3, audit plug-ins.',
  '@livesaver/xml':
    'Lossless byte-level XML scanner and byte-exact patcher for large Ableton Live files.',
  '@livesaver/core': 'Ableton Live file formats: documents, FileRefs, paths, CRC and fingerprints.',
  '@livesaver/ops':
    'livesaver operations: doctor, relink, Collect All and Save, transactions and reports.',
  '@livesaver/node':
    'Node.js/Bun host for livesaver: file system, gzip, walker, Live setup discovery.',
  '@livesaver/plugins': 'Plug-in identity and VST2→VST3 migration for Ableton Live Sets.',
  '@livesaver/catalog': 'SQLite catalog and search over Ableton Live projects.',
}

const publish = process.argv.includes('--publish')
const base = mkdtempSync(join(tmpdir(), 'livesaver-reserve-'))
const dirs: string[] = []

for (const [name, description] of Object.entries(NAMES)) {
  const dir = join(base, name.replace('/', '__'))
  mkdirSync(dir, { recursive: true })
  const manifest = {
    name,
    version: '0.0.0',
    description: `${description} (Name reserved: livesaver is in development.)`,
    license: 'MIT',
    author: 'Manuel Haller Polo',
    repository: { type: 'git', url: 'git+https://github.com/Polobase/livesaver.git' },
    homepage: 'https://github.com/Polobase/livesaver#readme',
    keywords: ['ableton', 'ableton-live', 'livesaver'],
    files: ['README.md'],
    publishConfig: { access: 'public' },
  }
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(
    join(dir, 'README.md'),
    `# ${name}\n\n${description}\n\nThis name is reserved for [livesaver](https://github.com/Polobase/livesaver), ` +
      'which is in development. The first usable release will be 0.1.0.\n',
  )
  dirs.push(dir)
}

console.log(`Placeholders prepared in ${base}\n`)
if (!publish) {
  console.log('To publish (after `npm login` and creating the npm org "livesaver"):\n')
  for (const dir of dirs) console.log(`  (cd '${dir}' && npm publish --access public)`)
  console.log('\nor: bun scripts/reserve-npm-names.ts --publish')
  process.exit(0)
}

let failed = 0
for (const dir of dirs) {
  const result = spawnSync('npm', ['publish', '--access', 'public'], { cwd: dir, stdio: 'inherit' })
  if (result.status !== 0) failed++
}
process.exit(failed ? 1 : 0)
