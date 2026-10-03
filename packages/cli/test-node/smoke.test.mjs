// Node.js smoke test of the built packages (run after `bun run build`): `bun run test:node`.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'bin.js')
// What the command line prints is compared as text: no colours, also where a CI asks for them.
const plain = { ...process.env, NO_COLOR: '1', FORCE_COLOR: undefined }

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
  const root = mkdtempSync(join(tmpdir(), 'livesaver-node-'))
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
    assert.deepEqual([record.command, record.apply, record.targets], ['collect', true, [project]])
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
    rmSync(root, { recursive: true, force: true })
  }
})

test('status --apply under Node sets Finder tags (xattr tool), undo removes them', {
  skip: process.platform !== 'darwin',
}, () => {
  const root = mkdtempSync(join(tmpdir(), 'livesaver-node-'))
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
    rmSync(root, { recursive: true, force: true })
  }
})

test('web under Node serves the page it ships with, and answers only that page', async () => {
  const root = mkdtempSync(join(tmpdir(), 'livesaver-node-'))
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
      [root],
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
    rmSync(root, { recursive: true, force: true })
  }
})

test('web --pair under Node names the link that connects the app on the site, and lets that site in', async () => {
  const root = mkdtempSync(join(tmpdir(), 'livesaver-node-'))
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
    rmSync(root, { recursive: true, force: true })
  }
})
