/** What the command line prints arrives whole, also in a pipe that takes it piece by piece. */
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { liveSet, makeProject, tempDir, writeSet } from '@livesaver/test-kit'

const BIN = fileURLToPath(new URL('../src/bin.ts', import.meta.url))

let tmp: { path: string; cleanup: () => void }
beforeEach(() => {
  tmp = tempDir()
})
afterEach(() => tmp.cleanup())

test('a result larger than a pipe holds at once is not cut off', () => {
  const projects = join(tmp.path, 'projects')
  for (let i = 0; i < 400; i++)
    writeSet(join(makeProject(projects, `Song ${i}`), `Song ${i}.als`), liveSet())
  // Settings of its own: nothing of the computer the test runs on is searched.
  const config = join(tmp.path, 'config.json')
  writeFileSync(config, JSON.stringify({ appResources: '', vendorLibraries: [], searchRoots: [] }))
  // As typed in a shell: `livesaver doctor … --json 2>/dev/null | jq`. The pipe is the shell's;
  // one made by a test runner behaves differently and hides the problem.
  const run = spawnSync(
    '/bin/sh',
    [
      '-c',
      '"$RUNTIME" "$BIN" doctor "$PROJECTS" --config "$CONFIG" --no-default-search --json --full 2>/dev/null | cat',
    ],
    {
      env: {
        ...process.env,
        RUNTIME: process.execPath,
        BIN,
        PROJECTS: projects,
        CONFIG: config,
        LIVESAVER_HOME: join(tmp.path, 'home'),
      },
      maxBuffer: 64 * 1024 * 1024,
    },
  )
  const text = run.stdout.toString('utf8')
  expect(text.length).toBeGreaterThan(65536)
  expect((JSON.parse(text) as { sets: unknown[] }).sets.length).toBe(400)
})
