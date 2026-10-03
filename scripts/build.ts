/**
 * Build every workspace in dependency order. A package's build (`tsc -p tsconfig.build.json`)
 * resolves its `@livesaver/*` dependencies through their published `dist` types, so each
 * dependency must be built first. `bun run --filter '*' build` does not wait for workspace
 * dependencies on a clean checkout, hence this script.
 *
 * Workspaces are built in waves: every workspace whose dependencies are already built runs in
 * parallel; the output of each build is printed when it finishes.
 *
 * Each workspace's `dist` is deleted right before its build. `tsc` only adds and overwrites
 * files, so without the clean a deleted or renamed source would leave its stale `.js`/`.d.ts`
 * in `dist`, and `files: ["dist", …]` would publish it. Workspaces in one wave never depend on
 * each other, so cleaning inside a wave cannot remove a dependency's output.
 *
 * Usage: bun scripts/build.ts
 */
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

interface Manifest {
  readonly name?: string
  readonly workspaces?: readonly string[]
  readonly scripts?: Readonly<Record<string, string>>
  readonly dependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
}

interface Workspace {
  readonly name: string
  readonly dir: string
  readonly deps: readonly string[]
}

function readManifest(path: string): Manifest {
  return JSON.parse(readFileSync(path, 'utf8')) as Manifest
}

/** Workspaces that define a `build` script, with their in-workspace dependencies. */
function workspaces(): Workspace[] {
  const root = readManifest(join(ROOT, 'package.json'))
  const found: { name: string; dir: string; manifest: Manifest }[] = []
  for (const pattern of root.workspaces ?? []) {
    for (const file of new Bun.Glob(`${pattern}/package.json`).scanSync({ cwd: ROOT })) {
      const manifest = readManifest(join(ROOT, file))
      if (manifest.name && manifest.scripts?.build) {
        found.push({ name: manifest.name, dir: join(ROOT, dirname(file)), manifest })
      }
    }
  }
  const names = new Set(found.map((w) => w.name))
  return found.map(({ name, dir, manifest }) => {
    const declared = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
    }
    return { name, dir, deps: Object.keys(declared).filter((d) => names.has(d)) }
  })
}

/** Delete `<workspace>/dist`; refuses any path that does not resolve inside the repository. */
function cleanDist(ws: Workspace): void {
  const dist = resolve(ws.dir, 'dist')
  if (!dist.startsWith(ROOT + sep) || dirname(dist) !== resolve(ws.dir)) {
    throw new Error(`refusing to clean ${dist}: not a workspace dist inside ${ROOT}`)
  }
  rmSync(dist, { recursive: true, force: true })
}

async function build(ws: Workspace): Promise<boolean> {
  const started = performance.now()
  cleanDist(ws)
  const proc = Bun.spawn(['bun', 'run', 'build'], { cwd: ws.dir, stdout: 'pipe', stderr: 'pipe' })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  const seconds = ((performance.now() - started) / 1000).toFixed(1)
  const text = `${out}${err}`.trimEnd()
  if (text) for (const line of text.split('\n')) console.log(`${ws.name} build: ${line}`)
  console.log(`${ws.name} build: exited with code ${code} (${relative(ROOT, ws.dir)}, ${seconds}s)`)
  return code === 0
}

/**
 * `livesaver web` serves the page from its own package, so the built page (without its source
 * maps) goes into the CLI's `dist`. Both are built by then: the web app depends on the CLI.
 */
function shipWebApp(): void {
  const page = join(ROOT, 'apps', 'web', 'dist')
  const cli = join(ROOT, 'packages', 'cli', 'dist')
  if (!existsSync(join(page, 'index.html')) || !existsSync(cli)) return
  const shipped = join(cli, 'web-app')
  rmSync(shipped, { recursive: true, force: true })
  cpSync(page, shipped, { recursive: true, filter: (source) => !source.endsWith('.map') })
  console.log(`livesaver build: web app copied to ${relative(ROOT, shipped)}`)
}

async function main(): Promise<number> {
  const pending = new Map(workspaces().map((w) => [w.name, w]))
  const built = new Set<string>()
  while (pending.size > 0) {
    const wave = [...pending.values()].filter((w) => w.deps.every((d) => built.has(d)))
    if (wave.length === 0) {
      console.error(`dependency cycle among: ${[...pending.keys()].join(', ')}`)
      return 1
    }
    const results = await Promise.all(wave.map(build))
    const failed = wave.filter((_, i) => !results[i]).map((w) => w.name)
    if (failed.length > 0) {
      console.error(`build failed: ${failed.join(', ')}`)
      return 1
    }
    for (const w of wave) {
      built.add(w.name)
      pending.delete(w.name)
    }
  }
  shipWebApp()
  return 0
}

process.exit(await main())
