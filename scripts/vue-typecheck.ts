/**
 * Type-check the `.vue` files of the workspace this is run in. `vue-tsc` only works under
 * Node.js: under Bun it cannot read `.vue` files and reports errors that are none. So this looks
 * for a real Node; on a machine with Bun only it says so and skips, and CI does the check.
 *
 * Usage (in a workspace): bun ../../scripts/vue-typecheck.ts [tsconfig.json | --build]
 * `--build`: the workspace's tsconfig only refers to others (a Nuxt app), which are all checked.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const asked = process.argv[2] ?? 'tsconfig.json'
const args = asked === '--build' ? ['--build', '--noEmit'] : ['--noEmit', '-p', asked]
const vueTsc = join(process.cwd(), 'node_modules', 'vue-tsc', 'bin', 'vue-tsc.js')
if (!existsSync(vueTsc)) {
  console.error(`vue-tsc is not installed in ${process.cwd()}`)
  process.exit(1)
}

/** `node` on the PATH, unless it is Bun standing in for it. */
function realNode(): string | undefined {
  const node = Bun.which('node')
  if (!node) return undefined
  const probe = Bun.spawnSync([node, '-p', 'process.versions.bun ?? ""'])
  return probe.exitCode === 0 && probe.stdout.toString().trim() === '' ? node : undefined
}

const node = realNode()
if (!node) {
  const note = 'The .vue files were not type-checked: vue-tsc needs Node.js, and none was found.'
  if (process.env.CI) {
    console.error(note)
    process.exit(1)
  }
  console.log(`${note} (CI checks them.)`)
  process.exit(0)
}
const run = Bun.spawnSync([node, vueTsc, ...args], {
  stdout: 'inherit',
  stderr: 'inherit',
})
process.exit(run.exitCode)
