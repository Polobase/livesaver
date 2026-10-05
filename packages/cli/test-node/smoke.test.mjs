// Node.js smoke test of the built packages (run after `bun run build`): `bun run test:node`.
// It runs on macOS, Linux and Windows: what it checks of a path holds on each of them.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const bin = join(here, '..', 'dist', 'bin.js')
const fixtures = join(here, '..', '..', '..', 'fixtures')
// What the command line prints is compared as text: no colours, also where a CI asks for them.
const plain = { ...process.env, NO_COLOR: '1', FORCE_COLOR: undefined }
const windows = process.platform === 'win32'
/** A path as livesaver names it: with `/` between its parts, on Windows too. */
const shown = (path) => (windows ? path.replaceAll('\\', '/') : path)
/** A temporary folder. (Windows may name it by a short name, `RUNNER~1`: its real name is taken.) */
function temp() {
  const dir = mkdtempSync(join(tmpdir(), 'livesaver-node-'))
  return windows ? realpathSync.native(dir) : dir
}
/** Removes it again. (Windows lets go of a file a moment after its program ended.) */
const remove = (dir) =>
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })

function set(samplePath, size) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="12.0_12402" Creator="Ableton Live 12.4.6">
\t<LiveSet>
\t\t<SampleRef>
\t\t\t<FileRef>
\t\t\t\t<RelativePathType Value="0" />
\t\t\t\t<RelativePath Value="" />
\t\t\t\t<Path Value="${samplePath}" />
\t\t\t\t<Type Value="2" />
\t\t\t\t<LivePackName Value="" />
\t\t\t\t<LivePackId Value="" />
\t\t\t\t<OriginalFileSize Value="${size}" />
\t\t\t\t<OriginalCrc Value="0" />
\t\t\t</FileRef>
\t\t\t<LastModDate Value="1" />
\t\t</SampleRef>
\t</LiveSet>
</Ableton>
`
}

test('collect --apply under Node relinks and collects, undo restores', () => {
  const root = temp()
  const env = {
    ...plain,
    LIVESAVER_HOME: join(root, 'home'),
    LIVESAVER_TRASH_DIR: join(root, 'trash'),
  }
  try {
    const project = join(root, 'Song Project')
    mkdirSync(join(project, 'Ableton Project Info'), { recursive: true })
    const sample = join(root, 'library', 'Kick.wav')
    mkdirSync(dirname(sample), { recursive: true })
    writeFileSync(sample, 'RIFF kick')
    const setPath = join(project, 'Song.als')
    const original = gzipSync(set('/gone/Kick.wav', 9))
    writeFileSync(setPath, original)
    const args = [
      'collect',
      project,
      '--no-default-search',
      '--search',
      join(root, 'library'),
      '--apply',
      '--force',
      '--json',
      '--workers',
      '2',
    ]
    const run = spawnSync(process.execPath, [bin, ...args], { env, encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    const out = JSON.parse(run.stdout)
    assert.equal(out.counts.found, 1)
    assert.equal(out.sets[0].written, true)
    assert.equal(
      readFileSync(join(project, 'Samples', 'Imported', 'Kick.wav'), 'utf8'),
      'RIFF kick',
    )
    const undo = spawnSync(process.execPath, [bin, 'undo', out.run, '--force'], {
      env,
      encoding: 'utf8',
    })
    assert.equal(undo.status, 0, undo.stderr)
    assert.deepEqual(readFileSync(setPath), original)
    // The run folder says what was asked, and the list of runs what became of it.
    const record = JSON.parse(readFileSync(join(root, 'home', 'runs', out.run, 'run.json'), 'utf8'))
    assert.deepEqual(
      [record.command, record.apply, record.targets],
      ['collect', true, [shown(project)]],
    )
    assert.equal(record.outcome.written, 1)
    const runs = spawnSync(process.execPath, [bin, 'runs'], { env, encoding: 'utf8' })
    assert.match(runs.stdout, new RegExp(`${out.run}\\s+1 set written, 1 file copied · undone`))
    // `--certain-only` is taken; a file of the stored size counts as certain where the
    // reference stores no checksum, so this one is still repaired.
    const certain = spawnSync(
      process.execPath,
      [
        bin,
        'doctor',
        project,
        '--no-default-search',
        '--search',
        join(root, 'library'),
        '--certain-only',
        '--json',
      ],
      { env, encoding: 'utf8' },
    )
    assert.equal(certain.status, 0, certain.stderr)
    assert.equal(JSON.parse(certain.stdout).counts.found, 1)
  } finally {
    remove(root)
  }
})

test('a project that Live saved is fixed and put back, the same on every system', () => {
  const root = temp()
  const env = {
    ...plain,
    LIVESAVER_HOME: join(root, 'home'),
    LIVESAVER_TRASH_DIR: join(root, 'trash'),
  }
  try {
    cpSync(join(fixtures, 'projects'), join(root, 'projects'), { recursive: true })
    cpSync(join(fixtures, 'samples'), join(root, 'samples'), { recursive: true })
    const project = join(root, 'projects', 'Brokenpath Project')
    const setPath = join(project, 'Brokenpath.als')
    const copy = join(project, 'Samples', 'Imported', '1.wav')
    const original = readFileSync(setPath)
    const look = ['--no-default-search', '--search', join(root, 'samples'), '--json']
    const run = spawnSync(
      process.execPath,
      [bin, 'collect', join(root, 'projects'), ...look, '--apply', '--force', '--workers', '2'],
      { env, encoding: 'utf8' },
    )
    assert.equal(run.status, 0, run.stderr)
    const out = JSON.parse(run.stdout)
    assert.deepEqual(
      [out.base, out.counts.ok, out.counts.found, out.counts['not-found']],
      [shown(join(root, 'projects')), 1, 1, 0],
    )
    const fixed = out.sets.filter((set) => set.written)
    assert.deepEqual(
      fixed.map((set) => [set.set, set.changes.map((c) => [c.action, c.newPath, c.source])]),
      [
        [
          shown(setPath),
          [
            [
              'repaired',
              'Samples/Imported/1.wav',
              shown(join(root, 'samples', 'Lib1', 'Kick', '1.wav')),
            ],
          ],
        ],
      ],
    )
    assert.deepEqual(
      readFileSync(copy),
      readFileSync(join(fixtures, 'samples', 'Lib1', 'Kick', '1.wav')),
    )
    // In the set, the path reads as Live writes it: with `/`, on Windows after its drive.
    const xml = gunzipSync(readFileSync(setPath)).toString('utf8')
    assert.ok(xml.includes(`<Path Value="${shown(copy)}" />`), 'the whole path of the copy')
    assert.ok(
      xml.includes('<RelativePath Value="Samples/Imported/1.wav" />'),
      'its path in the project',
    )
    assert.equal(xml.includes('\\'), false, 'no backslash in the set')
    // Checked again, nothing is left to do.
    const again = spawnSync(
      process.execPath,
      [bin, 'doctor', join(root, 'projects'), ...look, '--full'],
      { env, encoding: 'utf8' },
    )
    assert.equal(again.status, 0, again.stderr)
    const after = JSON.parse(again.stdout).counts
    assert.deepEqual([after.ok, after.found, after['not-found']], [2, 0, 0])
    const undo = spawnSync(process.execPath, [bin, 'undo', out.run, '--force'], {
      env,
      encoding: 'utf8',
    })
    assert.equal(undo.status, 0, undo.stderr)
    assert.deepEqual(readFileSync(setPath), original)
    assert.equal(existsSync(copy), false, 'the copy is taken back')
  } finally {
    remove(root)
  }
})

test('env says where Ableton keeps its folders on this system', () => {
  const root = temp()
  const config = join(root, 'config.json')
  writeFileSync(config, '{}')
  try {
    const run = spawnSync(process.execPath, [bin, 'env', '--json', '--config', config], {
      env: { ...plain, LIVESAVER_HOME: join(root, 'home') },
      encoding: 'utf8',
    })
    assert.equal(run.status, 0, run.stderr)
    const found = JSON.parse(run.stdout)
    assert.equal(typeof found.liveRunning, 'boolean')
    for (const path of [found.userLibrary, found.factoryPacks, ...found.searchRoots])
      assert.equal(path.includes('\\'), false, `${path} is written with "/"`)
    // Without a Live that says otherwise: Music/Ableton on a Mac, Documents\Ableton on Windows.
    if (found.live.length === 0 && !found.libraryCfg)
      assert.equal(
        found.userLibrary,
        shown(join(homedir(), windows ? 'Documents' : 'Music', 'Ableton', 'User Library')),
      )
  } finally {
    remove(root)
  }
})

/** A project with one set that misses a sample, and the sample in a folder beside it. */
function projectWithLostSample(root) {
  const project = join(root, 'Song Project')
  mkdirSync(join(project, 'Ableton Project Info'), { recursive: true })
  mkdirSync(join(root, 'library'), { recursive: true })
  writeFileSync(join(root, 'library', 'Kick.wav'), 'RIFF kick')
  const setPath = join(project, 'Song.als')
  writeFileSync(setPath, gzipSync(set('/gone/Kick.wav', 9)))
  const args = ['collect', project, '--no-default-search', '--search', join(root, 'library')]
  return { project, setPath, args: [...args, '--apply', '--json', '--workers', '0'] }
}

test('on Windows nothing is written while a Live runs', { skip: !windows }, async () => {
  const root = temp()
  const env = {
    ...plain,
    LIVESAVER_HOME: join(root, 'home'),
    LIVESAVER_TRASH_DIR: join(root, 'trash'),
  }
  // All that can be asked is the list of what runs: a program called like Live stands in.
  const program = join(root, 'Ableton Live 12 Suite.exe')
  copyFileSync(process.execPath, program)
  const live = spawn(program, ['-e', 'setTimeout(() => {}, 300000)'], { stdio: 'ignore' })
  try {
    await once(live, 'spawn')
    const { setPath, args } = projectWithLostSample(root)
    const original = readFileSync(setPath)
    const run = spawnSync(process.execPath, [bin, ...args], { env, encoding: 'utf8' })
    assert.equal(run.status, 1, run.stdout)
    assert.match(run.stderr, /Ableton Live is running/)
    assert.deepEqual(readFileSync(setPath), original)
    const found = spawnSync(process.execPath, [bin, 'env', '--json'], { env, encoding: 'utf8' })
    assert.equal(JSON.parse(found.stdout).liveRunning, true)
  } finally {
    live.kill()
    await once(live, 'exit').catch(() => {})
    remove(root)
  }
  // Once it is gone, the list no longer names it.
  const found = spawnSync(process.execPath, [bin, 'env', '--json'], {
    env: plain,
    encoding: 'utf8',
  })
  assert.equal(JSON.parse(found.stdout).liveRunning, false)
})

test('on Windows an undo moves what a fix copied to a trash folder of its own', {
  skip: !windows,
}, () => {
  const root = temp()
  // No folder is named for it (the other tests name one): it is the one in AppData\Local, with
  // the runs beside it. (Not the Recycle Bin: see `packages/node/src/write.ts`.)
  const local = join(root, 'local')
  const env = {
    ...plain,
    LOCALAPPDATA: local,
    LIVESAVER_HOME: undefined,
    LIVESAVER_TRASH_DIR: undefined,
  }
  try {
    const { project, setPath, args } = projectWithLostSample(root)
    const original = readFileSync(setPath)
    const run = spawnSync(process.execPath, [bin, ...args], { env, encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    const out = JSON.parse(run.stdout)
    const copy = join(project, 'Samples', 'Imported', 'Kick.wav')
    assert.equal(existsSync(copy), true)
    assert.equal(existsSync(join(local, 'livesaver', 'runs', out.run, 'run.json')), true)
    const undo = spawnSync(process.execPath, [bin, 'undo', out.run], { env, encoding: 'utf8' })
    assert.equal(undo.status, 0, `${undo.stdout}\n${undo.stderr}`)
    assert.deepEqual(readFileSync(setPath), original)
    assert.equal(existsSync(copy), false, 'the copy is taken out of the project')
    assert.equal(readFileSync(join(local, 'livesaver', 'Trash', 'Kick.wav'), 'utf8'), 'RIFF kick')
  } finally {
    remove(root)
  }
})

test('status --apply under Node sets Finder tags (xattr tool), undo removes them', {
  skip: process.platform !== 'darwin',
}, () => {
  const root = temp()
  const env = { ...plain, LIVESAVER_HOME: join(root, 'home') }
  const tags = (path) =>
    spawnSync('/usr/bin/xattr', ['-p', 'com.apple.metadata:_kMDItemUserTags', path], {
      encoding: 'utf8',
    }).status === 0
  try {
    const project = join(root, 'Song Project')
    mkdirSync(join(project, 'Ableton Project Info'), { recursive: true })
    const setPath = join(project, 'Song.als')
    writeFileSync(setPath, gzipSync(set('/gone/Kick.wav', 9)))
    const args = ['status', root, '--apply', '--no-comments', '--no-sheet', '--no-auval']
    const run = spawnSync(process.execPath, [bin, ...args, '--json', '--workers', '2'], {
      env,
      encoding: 'utf8',
    })
    assert.equal(run.status, 0, run.stderr)
    const out = JSON.parse(run.stdout)
    assert.deepEqual(out.outcome.tagsChanged.sort(), [project, setPath].sort())
    assert.equal(tags(setPath), true)
    const undo = spawnSync(process.execPath, [bin, 'undo', out.run, '--force'], {
      env,
      encoding: 'utf8',
    })
    assert.equal(undo.status, 0, undo.stderr)
    assert.equal(tags(setPath), false)
    assert.equal(tags(project), false)
  } finally {
    remove(root)
  }
})

test('web under Node serves the page it ships with, and answers only that page', async () => {
  const root = temp()
  const env = { ...plain, LIVESAVER_HOME: join(root, 'home') }
  const config = join(root, 'config.json')
  writeFileSync(config, JSON.stringify({ appResources: '', searchRoots: [root] }))
  const child = spawn(
    process.execPath,
    [bin, 'web', '--no-open', '--port', '0', '--config', config],
    { env },
  )
  try {
    const url = await new Promise((resolve, reject) => {
      let out = ''
      child.stdout.on('data', (chunk) => {
        out += chunk
        const found = /http:\/\/127\.0\.0\.1:\d+\//.exec(out)
        if (found) resolve(found[0])
      })
      child.on('exit', (code) => reject(new Error(`web exited with ${code}: ${out}`)))
      child.stderr.on('data', (chunk) => {
        out += chunk
      })
    })
    const page = await (await fetch(url)).text()
    const token = /name="livesaver-local" content="([0-9a-f]+)"/.exec(page)?.[1]
    assert.ok(token, 'the served page carries the token')
    // The page's script, its styles and the workers of a scan in the browser are shipped along.
    const script = /<script type="module"[^>]* src="\.\/(assets\/[^"]+\.js)"/.exec(page)?.[1]
    assert.ok(script, 'the page names its script')
    const shipped = readdirSync(join(dirname(bin), 'web-app', 'assets'))
    const worker = shipped.find((name) => /^engine\.worker-.*\.js$/.test(name))
    assert.ok(worker, 'the engine worker is shipped')
    for (const [file, type] of [
      [script, 'text/javascript; charset=utf-8'],
      [`assets/${worker}`, 'text/javascript; charset=utf-8'],
      [`assets/${shipped.find((name) => name.endsWith('.css'))}`, 'text/css; charset=utf-8'],
      [`assets/${shipped.find((name) => name.endsWith('.woff2'))}`, 'font/woff2'],
    ]) {
      const answer = await fetch(`${url}${file}`)
      assert.deepEqual([file, answer.status, answer.headers.get('content-type')], [file, 200, type])
    }
    assert.equal(
      shipped.some((name) => name.endsWith('.map')),
      false,
      'no source maps',
    )
    assert.equal((await fetch(`${url}api/info`)).status, 403)
    const info = await (
      await fetch(`${url}api/info`, { headers: { 'x-livesaver-token': token } })
    ).json()
    assert.deepEqual(
      info.search.map((folder) => folder.path),
      [shown(root)],
    )
    const ask = async (path) =>
      (await fetch(`${url}${path}`, { headers: { 'x-livesaver-token': token } })).json()
    assert.deepEqual(await ask('api/runs'), [])
    assert.deepEqual(await ask('api/scan'), {})
    const status = await ask('api/status')
    assert.deepEqual([status.busy, status.lastScan], ['', ''])
    // Not started for pairing: a page of the site is a stranger.
    const stranger = await fetch(`${url}api/status`, {
      method: 'OPTIONS',
      headers: { origin: 'https://polobase.github.io' },
    })
    assert.equal(stranger.status, 403)
  } finally {
    child.kill('SIGINT')
    remove(root)
  }
})

test('web --pair under Node names the link that connects the app on the site, and lets that site in', async () => {
  const root = temp()
  const env = { ...plain, LIVESAVER_HOME: join(root, 'home') }
  const config = join(root, 'config.json')
  writeFileSync(config, JSON.stringify({ appResources: '', searchRoots: [root] }))
  const child = spawn(
    process.execPath,
    [bin, 'web', '--pair', '--no-open', '--port', '0', '--config', config],
    { env },
  )
  try {
    const link = await new Promise((resolve, reject) => {
      let out = ''
      child.stdout.on('data', (chunk) => {
        out += chunk
        const found = /https:\/\/polobase\.github\.io\/livesaver\/app\/#\/connect\?\S+/.exec(out)
        if (found) resolve(found[0])
      })
      child.on('exit', (code) => reject(new Error(`web exited with ${code}: ${out}`)))
    })
    const query = new URLSearchParams(link.slice(link.indexOf('?') + 1))
    const at = query.get('at')
    assert.match(at, /^http:\/\/127\.0\.0\.1:\d+$/)
    assert.match(query.get('token'), /^[0-9a-f]{48}$/)
    // What a browser asks before a page of the site may send the token, and the request itself.
    const site = 'https://polobase.github.io'
    const asked = await fetch(`${at}/api/info`, { method: 'OPTIONS', headers: { origin: site } })
    assert.deepEqual([asked.status, asked.headers.get('access-control-allow-origin')], [204, site])
    const info = await fetch(`${at}/api/info`, {
      headers: { origin: site, 'x-livesaver-token': query.get('token') },
    })
    assert.deepEqual([info.status, info.headers.get('access-control-allow-origin')], [200, site])
    assert.equal((await info.json()).api, 1)
  } finally {
    child.kill('SIGINT')
    remove(root)
  }
})
