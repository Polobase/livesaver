/** Which browser a page is in, and what each way of fixing from a site needs there. */
import { describe, expect, test } from 'bun:test'
import {
  BRAVE_FOLDERS,
  BRAVE_LOCALHOST,
  browserFacts,
  browserOf,
  unreachableAdvice,
  waysOf,
} from '../src/lib/ways.js'

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
const CHROME = `${MAC} AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36`
const AGENTS = {
  chrome: CHROME,
  edge: `${CHROME} Edg/141.0.0.0`,
  headless: `${MAC} AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36`,
  safari: `${MAC} AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15`,
  firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0',
  chromeOnPhone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1',
}
const SITE = 'https://livesaver.example'

describe('which browser this is', () => {
  test('Brave says so itself: its user agent is that of Chrome', () => {
    expect(browserOf({ userAgent: AGENTS.chrome, brave: true })).toBe('brave')
    expect(browserOf({ userAgent: AGENTS.chrome, brave: false })).toBe('chromium')
  })

  test('the others are known by their user agents, which name each other', () => {
    const of = (userAgent: string) => browserOf({ userAgent, brave: false })
    expect(of(AGENTS.edge)).toBe('chromium')
    expect(of(AGENTS.headless)).toBe('chromium')
    expect(of(AGENTS.safari)).toBe('safari')
    expect(of(AGENTS.firefox)).toBe('firefox')
    // On a phone of Apple every browser is Safari underneath.
    expect(of(AGENTS.chromeOnPhone)).toBe('safari')
    expect(of('')).toBe('other')
  })

  test('where there is no browser, nothing is claimed of one', () => {
    expect(browserFacts()).toEqual({
      userAgent: globalThis.navigator?.userAgent ?? '',
      brave: false,
      canEdit: false,
    })
  })
})

describe('the two ways to fix from a page of a site', () => {
  const ways = (userAgent: string, how: { brave?: boolean; canEdit?: boolean } = {}) =>
    waysOf({ userAgent, brave: how.brave ?? false, canEdit: how.canEdit ?? false })

  test('Chrome and Edge do both: one asks, the other is a switch of the page', () => {
    for (const agent of [AGENTS.chrome, AGENTS.edge]) {
      const both = ways(agent, { canEdit: true })
      expect(both.name).toBe('')
      expect(both.connect).toEqual({
        state: 'works',
        text: 'Your browser may ask whether this page may reach your computer: allow it.',
      })
      expect(both.edit).toEqual({
        state: 'works',
        text: 'Your browser can let this page edit a folder you choose.',
      })
    }
  })

  test('Brave does neither as it is, and each has one step in Brave’s own settings', () => {
    const brave = ways(AGENTS.chrome, { brave: true })
    expect(brave.name).toBe('Brave')
    expect(brave.connect.state).toBe('step')
    expect(brave.connect.address).toBe(BRAVE_LOCALHOST)
    expect(brave.connect.text).toContain('add this site to the sites that are allowed')
    expect(brave.edit.state).toBe('step')
    expect(brave.edit.address).toBe(BRAVE_FOLDERS)
    expect(brave.edit.text).toContain('choose “Enabled”, and restart Brave')
    // With its flag switched on, Brave edits folders as Chrome does.
    expect(ways(AGENTS.chrome, { brave: true, canEdit: true }).edit.state).toBe('works')
  })

  test('Firefox connects, and edits no folder', () => {
    const firefox = ways(AGENTS.firefox)
    expect(firefox.connect.state).toBe('works')
    expect(firefox.edit).toEqual({
      state: 'no',
      text: 'Firefox does not let a page edit a folder. Chrome and Edge do.',
    })
  })

  test('Safari does neither: the app that livesaver serves itself is the way there', () => {
    const safari = ways(AGENTS.safari)
    expect(safari.connect.state).toBe('no')
    expect(safari.connect.text).toContain('Use the app that “livesaver web” opens itself.')
    expect(safari.edit.text).toBe('Safari does not let a page edit a folder. Chrome and Edge do.')
  })

  test('a browser nobody knows is not named', () => {
    const unknown = ways('')
    expect(unknown.connect.state).toBe('works')
    expect(unknown.edit.text).toBe(
      'This browser does not let a page edit a folder. Chrome and Edge do.',
    )
    // One built on Chromium that hands out no folder may be Chrome itself: it is not told that
    // Chrome would do.
    expect(ways(AGENTS.chrome).edit).toEqual({
      state: 'no',
      text: 'This browser does not let this page edit a folder.',
    })
  })
})

describe('a connected page whose livesaver does not answer', () => {
  const advice = (userAgent: string, brave = false) =>
    unreachableAdvice(waysOf({ userAgent, brave, canEdit: false }), SITE)

  // The site to allow is the one the page is from, wherever the app is hosted.
  test('names the site to allow in Brave’s setting, and how to connect anew', () => {
    expect(advice(AGENTS.chrome, true)).toEqual([
      `If livesaver runs, Brave keeps this page from reaching it until you allow that: open Brave’s setting for it, add ${SITE} to the sites that are allowed, and reload this page. Or open the app from this computer, which needs no permission.`,
      'If it was stopped, start it again with “livesaver web --pair”, which connects this page anew.',
    ])
  })

  test('says in Safari that nothing can be allowed there, and does not send it round again', () => {
    const [blocked, stopped] = advice(AGENTS.safari)
    expect(blocked).toStartWith('Safari keeps a page of a site from reaching livesaver')
    expect(stopped).toBe(
      'If livesaver was stopped, start it again with “livesaver web”: it opens the app from this computer.',
    )
  })

  test('says in any other browser what may be the matter', () => {
    for (const agent of [AGENTS.chrome, AGENTS.firefox, '']) {
      const [blocked, stopped] = advice(agent)
      expect(blocked).toContain('your browser may keep this page from reaching it')
      expect(blocked).toContain('open the app from this computer')
      expect(stopped).toContain('start it again with “livesaver web --pair”')
    }
  })
})
