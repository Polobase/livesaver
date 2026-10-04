/**
 * A page connected to livesaver from elsewhere: the pairing behind the `#` of its address, which
 * may only name this computer, and the protocol version both sides have to agree on.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { copyFixtures, tempDir } from '@livesaver/test-kit'
import { pairingLink, startWeb, WEB_API, type WebServer } from 'livesaver'
import { API, ComputerEngine } from '../src/engine/computer.js'
import {
  clearPairing,
  keepPairing,
  type PairingStore,
  pairingIn,
  pairingOf,
  readPairing,
  takePairing,
} from '../src/engine/pairing.js'
import { Unreachable } from '../src/engine/types.js'

const TOKEN = 'ab'.repeat(24)

/** A tab's store, as a browser has it. */
function tabStore(): PairingStore & { readonly kept: Map<string, string> } {
  const kept = new Map<string, string>()
  return {
    kept,
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => void kept.set(key, value),
    removeItem: (key) => void kept.delete(key),
  }
}

describe('a pairing in the address of the page', () => {
  test('is read from behind the #, as the command line writes it', () => {
    const link = pairingLink(
      'https://polobase.github.io/livesaver/app/',
      'http://127.0.0.1:5483/',
      TOKEN,
    )
    expect(pairingIn(new URL(link).hash)).toEqual({ at: 'http://127.0.0.1:5483', token: TOKEN })
    expect(pairingIn(`#/connect?at=http%3A%2F%2Flocalhost%3A5483&token=${TOKEN}`)).toEqual({
      at: 'http://localhost:5483',
      token: TOKEN,
    })
    // Another place of the app is no pairing.
    expect(pairingIn('#/samples?tab=changes')).toBeUndefined()
    expect(pairingIn('')).toBeUndefined()
  })

  test('may only name this computer: a link must not make the page talk to another machine', () => {
    const link = (at: string, token = TOKEN) =>
      `#/connect?at=${encodeURIComponent(at)}&token=${token}`
    for (const at of [
      'https://evil.example',
      'http://evil.example:5483',
      'http://127.0.0.1.evil.example:5483',
      'http://127.0.0.1:5483@evil.example',
      'http://192.168.1.20:5483',
      'https://127.0.0.1:5483',
      'http://127.0.0.1',
      'http://127.0.0.1:5483/somewhere',
      'javascript:alert(1)',
      '',
    ])
      expect([at, pairingIn(link(at))]).toEqual([at, undefined])
    // And the token is one of livesaver's, not anything a link may carry.
    for (const token of ['', 'short', `${TOKEN}"><script>`, 'G'.repeat(48)])
      expect([token, pairingIn(link('http://127.0.0.1:5483', token))]).toEqual([token, undefined])
  })

  test('is taken out of the address and kept for the tab', () => {
    const store = tabStore()
    const replaced: string[] = []
    const history = {
      replaceState: (_: unknown, __: string, url?: string | URL | null) =>
        void replaced.push(String(url)),
    }
    const taken = takePairing(
      {
        hash: `#/connect?at=http%3A%2F%2F127.0.0.1%3A5483&token=${TOKEN}`,
        pathname: '/livesaver/app/',
        search: '',
      },
      history,
      store,
    )
    expect(taken).toEqual({ at: 'http://127.0.0.1:5483', token: TOKEN })
    // The token no longer stands in the address, where it could be seen or bookmarked.
    expect(replaced).toEqual(['/livesaver/app/#/'])
    expect(readPairing(store)).toEqual(taken)
    clearPairing(store)
    expect(readPairing(store)).toBeUndefined()

    // A link that is no good is taken out of the address as well, and nothing is kept.
    expect(
      takePairing(
        { hash: '#/connect?at=https%3A%2F%2Fevil.example&token=x', pathname: '/', search: '' },
        history,
        store,
      ),
    ).toBeUndefined()
    expect([replaced.at(-1), store.kept.size]).toEqual(['/#/', 0])
    // Any other address is left as it is.
    expect(
      takePairing({ hash: '#/history', pathname: '/', search: '' }, history, store),
    ).toBeUndefined()
    expect(replaced).toHaveLength(2)
  })

  test('is read from a link that was pasted, for a tab that is already open', () => {
    const link = pairingLink(
      'https://polobase.github.io/livesaver/app/',
      'http://127.0.0.1:5483/',
      TOKEN,
    )
    const pairing = { at: 'http://127.0.0.1:5483', token: TOKEN }
    expect(pairingOf(link)).toEqual(pairing)
    // As it comes out of a terminal: with the words before it, and a line end after it.
    expect(pairingOf(`Connected to it, the app at https://polobase.github.io: ${link}\n`)).toEqual(
      pairing,
    )
    expect(pairingOf(new URL(link).hash)).toEqual(pairing)
    // The address of the app alone, or of livesaver, is no pairing; nor is a link elsewhere.
    for (const other of [
      'https://polobase.github.io/livesaver/app/',
      'http://127.0.0.1:5483/',
      `https://polobase.github.io/livesaver/app/#/connect?at=https%3A%2F%2Fevil.example&token=${TOKEN}`,
      'livesaver web --pair',
      '',
    ])
      expect([other, pairingOf(other)]).toEqual([other, undefined])

    // Kept, it is what the tab starts with from then on.
    const store = tabStore()
    keepPairing(store, pairing)
    expect(readPairing(store)).toEqual(pairing)
  })

  test('what the tab kept is checked again when it is read', () => {
    const store = tabStore()
    for (const kept of ['not json', '{"at":"https://evil.example","token":"x"}', 'null', '[]']) {
      store.setItem('livesaver-pairing', kept)
      expect([kept, readPairing(store)]).toEqual([kept, undefined])
    }
  })
})

describe('a page connected to livesaver', () => {
  let tmp: { path: string; cleanup: () => void }
  let server: WebServer
  const home = process.env.LIVESAVER_HOME

  beforeEach(async () => {
    tmp = tempDir()
    const { samples } = copyFixtures(tmp.path)
    process.env.LIVESAVER_HOME = join(tmp.path, 'home')
    const config = join(tmp.path, 'config.json')
    writeFileSync(
      config,
      JSON.stringify({ appResources: '', vendorLibraries: [], searchRoots: [samples] }),
    )
    server = await startWeb({ assets: false, config, version: '1.2.3', liveRunning: () => false })
  })
  afterEach(async () => {
    await server.close()
    tmp.cleanup()
    if (home === undefined) delete process.env.LIVESAVER_HOME
    else process.env.LIVESAVER_HOME = home
  })

  test('speaks the protocol of the command line it was built with', async () => {
    expect(API).toBe(WEB_API)
    const engine = new ComputerEngine({ token: server.token, base: server.url, paired: true })
    expect(engine.paired).toBe(true)
    expect((await engine.start()).version).toBe('1.2.3')
    expect(new ComputerEngine({ token: server.token, base: server.url }).paired).toBe(false)
  })

  test('says so when its livesaver is older or newer than it, instead of misreading it', async () => {
    const other = (api: number | undefined): typeof fetch =>
      (async (url: string, init?: RequestInit) => {
        const answer = await fetch(url, init)
        if (!String(url).endsWith('/api/info')) return answer
        const { api: _api, ...info } = (await answer.json()) as { api: number }
        return Response.json(api === undefined ? info : { ...info, api })
      }) as typeof fetch
    for (const api of [WEB_API + 1, 0, undefined]) {
      const engine = new ComputerEngine({
        token: server.token,
        base: server.url,
        fetch: other(api),
      })
      const failed = await engine.start().catch((error: unknown) => error)
      expect(failed).toBeInstanceOf(Unreachable)
      expect((failed as Error).message).toBe(
        'This page and livesaver 1.2.3 on this computer do not fit together: one of them is newer than the other.',
      )
    }
  })
})
