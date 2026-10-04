/**
 * How a page of a site gets to fix, said for the browser at hand: what each of the three
 * engines is told about itself, and what Brave is told. Brave cannot be driven by a test. It is
 * made up here by what tells it apart (it says so in `navigator.brave`, and hands a page no
 * folder to edit), in Chromium, which it is built on. Whether Brave's own settings then let
 * the page through is for a person to try.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { copyFixtures, tempDir } from '@livesaver/test-kit'
import { pairingLink, startWeb, type WebServer } from 'livesaver'
import { type Browser, chromium, type Page } from 'playwright'
import { build, DIST } from '../build.js'
import { serve } from '../serve.js'
import {
  barriers,
  ENGINES,
  giveFolder,
  idle,
  noPlugins,
  PATIENCE,
  restoreState,
  stateIn,
  textOf,
  textsOf,
  watch,
} from './support.js'

/** The app as plain files at one address: a page on its own. */
let site: { url: string; stop: () => void }
/** livesaver at another address, which lets the pages of that one in and serves the app itself. */
let server: WebServer
let tmp: { path: string; cleanup: () => void }
let projects: string
let samples: string

beforeAll(async () => {
  await build()
  site = serve()
  tmp = tempDir()
  ;({ projects, samples } = copyFixtures(tmp.path))
  stateIn(tmp.path)
  const config = join(tmp.path, 'config.json')
  writeFileSync(
    config,
    JSON.stringify({
      appResources: '',
      vendorLibraries: [],
      searchRoots: [samples],
      status: { projects },
    }),
  )
  server = await startWeb({
    assets: DIST,
    config,
    liveRunning: () => false,
    plugins: noPlugins,
    pair: origin(),
  })
}, 120_000 * PATIENCE)
afterAll(async () => {
  if (server) await idle(server)
  await server?.close()
  site?.stop()
  tmp?.cleanup()
  restoreState()
})

/** Where the page is from: what a browser's setting wants to be told. */
const origin = () => new URL(site.url).origin

const BRAVE_LOCALHOST = 'brave://settings/content/localhostAccess'
const BRAVE_FOLDERS = 'brave://flags/#file-system-access-api'

/** What each engine is told: the test browsers call themselves Chrome, Safari and Firefox. */
const SAID: Record<string, { connect: string; edit: string; pairs: boolean; edits: boolean }> = {
  Chromium: {
    connect: 'Your browser may ask whether this page may reach your computer: allow it.',
    edit: 'Your browser can let this page edit a folder you choose.',
    pairs: true,
    edits: true,
  },
  WebKit: {
    connect: 'Safari does not let a page of a site reach your computer.',
    edit: 'Safari does not let a page edit a folder. Chrome and Edge do.',
    pairs: false,
    edits: false,
  },
  Firefox: {
    connect: 'Your browser may ask whether this page may reach your computer: allow it.',
    edit: 'Firefox does not let a page edit a folder. Chrome and Edge do.',
    pairs: true,
    edits: false,
  },
}

for (const [name, type] of ENGINES) {
  describe(`how a page can fix, said in ${name}`, () => {
    let browser: Browser
    const said = SAID[name] as (typeof SAID)[string]

    beforeAll(async () => {
      browser = await type.launch()
    }, 60_000 * PATIENCE)
    afterAll(async () => {
      await browser?.close()
    })

    test(
      'the card that cannot fix leads to the two ways, each said for this browser',
      async () => {
        const { page, problems, outside } = await watch(browser, site.url)
        await page.goto(site.url)
        await giveFolder(page, 'projects-input', projects)
        await giveFolder(page, 'search-input', samples)
        await page.getByTestId('scan-library').click()
        const card = page.getByTestId('fix-card')
        await card.getByText('1 set in 1 project').waitFor({ timeout: 30_000 * PATIENCE })
        expect(await textOf(card.getByTestId('no-fix'))).toContain('This page only reads.')

        await card.getByTestId('how-to-fix').click()
        const dialog = page.getByRole('dialog')
        await dialog.getByTestId('where-dialog').waitFor()
        expect(await textOf(dialog)).toContain('To fix from here, there are two ways.')
        // The way that needs nothing of the browser comes first, in every browser.
        const connect = dialog.getByTestId('way-connect')
        expect(await textsOf(connect.getByTestId('copy-text').locator('code'))).toEqual(
          said.pairs ? ['livesaver web', 'livesaver web --pair'] : ['livesaver web'],
        )
        expect(await textOf(connect.getByTestId('connect-way'))).toContain(said.connect)
        // Where the browser lets no page of a site through, there is nothing to connect with.
        expect(await connect.getByTestId('pairing-link').count()).toBe(said.pairs ? 1 : 0)
        expect(await textOf(dialog.getByTestId('edit-way'))).toContain(said.edit)
        expect(
          await dialog.getByRole('link', { name: 'Switch it on in the Settings' }).count(),
        ).toBe(said.edits ? 1 : 0)
        for (const scheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme: scheme })
          expect([scheme, await barriers(page)]).toEqual([scheme, []])
        }
        if (said.edits) {
          await dialog.getByRole('link', { name: 'Switch it on in the Settings' }).click()
          await page.getByRole('heading', { level: 1, name: 'Settings' }).waitFor()
          await dialog.waitFor({ state: 'hidden' })
        }
        expect(problems).toEqual([])
        expect(outside).toEqual([])
        await page.context().close()
      },
      90_000 * PATIENCE,
    )

    const whenItPairs = said.pairs ? test : test.skip
    whenItPairs(
      'the link that “livesaver web --pair” printed connects a tab that is already open',
      async () => {
        const { page, problems, outside } = await watch(browser, site.url)
        await page.goto(site.url)
        await page.getByTestId('where').click()
        const dialog = page.getByRole('dialog')
        const field = dialog.getByTestId('pairing-link')
        const go = dialog.getByTestId('pairing-connect')
        expect(await go.isDisabled()).toBe(true)
        // Something else than the link is refused in words, and the page stays as it is.
        await field.fill(site.url)
        await go.click()
        await dialog.getByText('This is not that link').waitFor()
        expect(await barriers(page)).toEqual([])
        await field.fill('')
        expect(await dialog.getByText('This is not that link').count()).toBe(0)

        // As it is copied from a terminal: the line it stands in, with its end.
        const link = pairingLink(site.url, server.url, server.token)
        await field.fill(`Connected to it, the app at ${origin()}: ${link}\n`)
        await go.click()
        await page.getByTestId('where').getByText('On this computer').waitFor()
        // The folders are those of this computer's settings, by their paths.
        await page.getByTestId('folder-row').first().waitFor()
        expect(await page.getByTestId('folder-name').allInnerTexts()).toEqual([
          'projects',
          'samples',
        ])
        // The token was never part of the address.
        expect(page.url()).toBe(`${site.url}#/`)
        expect(problems).toEqual([])
        expect(outside.filter((url) => !url.startsWith(server.url))).toEqual([])
        await page.context().close()
      },
      60_000 * PATIENCE,
    )
  })
}

describe('what Brave is told (made up in Chromium)', () => {
  let browser: Browser

  beforeAll(async () => {
    browser = await chromium.launch()
  }, 60_000 * PATIENCE)
  afterAll(async () => {
    await browser?.close()
  })

  /** A page that takes itself to be in Brave as it comes: it says so, and edits no folder. */
  async function brave(): Promise<Page> {
    const { page } = await watch(browser, site.url)
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'brave', {
        value: { isBrave: async () => true },
        configurable: true,
      })
      Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true })
    })
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    return page
  }
  const copied = (page: Page) => page.evaluate(() => navigator.clipboard.readText())

  test(
    'each way has one step in Brave’s own settings, with the address to copy',
    async () => {
      const page = await brave()
      await page.goto(site.url)
      await page.getByTestId('where').click()
      const dialog = page.getByRole('dialog')
      const connect = dialog.getByTestId('connect-way')
      expect(await textOf(connect)).toContain(
        'Brave keeps a site from reaching your computer, and does not ask. Allow it once: open Brave’s setting for it, and add this site to the sites that are allowed.',
      )
      // A page cannot link to a browser's settings: the address and the site are there to copy.
      expect(await textsOf(connect.getByTestId('copy-text').locator('code'))).toEqual([
        'livesaver web --pair',
        BRAVE_LOCALHOST,
        origin(),
      ])
      await connect.getByRole('button', { name: 'Copy the address of the setting' }).click()
      expect(await copied(page)).toBe(BRAVE_LOCALHOST)
      await connect.getByRole('button', { name: 'Copy the address of this site' }).click()
      expect(await copied(page)).toBe(origin())
      // Allowed in Brave, the page connects as in any browser: the field for the link is there.
      expect(await dialog.getByTestId('pairing-link').count()).toBe(1)

      const edit = dialog.getByTestId('edit-way')
      expect(await textOf(edit)).toContain(
        'Brave lets a page edit a folder only once you switch that on: open Brave’s flag for it, choose “Enabled”, and restart Brave. Then switch it on in the Settings of this page.',
      )
      await edit.getByRole('button', { name: 'Copy the address of the flag' }).click()
      expect(await copied(page)).toBe(BRAVE_FOLDERS)
      expect(await dialog.getByRole('link', { name: 'Switch it on in the Settings' }).count()).toBe(
        0,
      )
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme })
        expect([scheme, await barriers(page)]).toEqual([scheme, []])
      }
      await dialog.getByRole('button', { name: 'Close' }).click()
      await dialog.waitFor({ state: 'hidden' })

      // The settings name the flag where the switch would be.
      await page.getByRole('link', { name: 'Settings', exact: true }).click()
      const impossible = page.getByTestId('writing').getByTestId('writing-impossible')
      expect(await textOf(impossible.getByTestId('writing-step'))).toContain(
        'Brave lets a page edit a folder only once you switch that on',
      )
      expect(await textsOf(impossible.getByTestId('copy-text').locator('code'))).toEqual([
        BRAVE_FOLDERS,
      ])
      expect(await page.getByTestId('writing').getByRole('switch').count()).toBe(0)
      expect(await barriers(page)).toEqual([])
      await page.context().close()
    },
    60_000 * PATIENCE,
  )

  test(
    'a connection that Brave keeps back names the setting, and the app of this computer is one link away',
    async () => {
      const page = await brave()
      // Brave refuses the request of a page of a site without a word to anyone.
      await page.route(`${server.url}api/**`, (route) => route.abort('blockedbyclient'))
      await page.goto(pairingLink(site.url, server.url, server.token))
      const alert = page.getByTestId('engine-problem')
      await alert.waitFor()
      expect(await textOf(alert)).toContain('livesaver on this computer does not answer.')
      expect(await textOf(alert)).toContain(
        `If livesaver runs, Brave keeps this page from reaching it until you allow that: open Brave’s setting for it, add ${origin()} to the sites that are allowed, and reload this page.`,
      )
      expect(await textOf(alert)).toContain('start it again with “livesaver web --pair”')
      expect(
        await textsOf(
          alert.getByTestId('browser-setting').getByTestId('copy-text').locator('code'),
        ),
      ).toEqual([BRAVE_LOCALHOST, origin()])
      await alert.getByRole('button', { name: 'Copy the address of the setting' }).click()
      expect(await copied(page)).toBe(BRAVE_LOCALHOST)
      expect(await barriers(page)).toEqual([])

      // livesaver's own address serves the same app, and going there is no request of a page.
      const own = alert.getByRole('link', { name: 'Open the app from this computer' })
      expect(await own.getAttribute('href')).toBe(server.url)
      await page.unroute(`${server.url}api/**`)
      await own.click()
      await page.getByTestId('where').getByText('On this computer').waitFor()
      expect(page.url().startsWith(server.url)).toBe(true)
      await page.getByTestId('folder-row').first().waitFor()
      expect(await page.getByTestId('engine-problem').count()).toBe(0)
      await page.context().close()
    },
    60_000 * PATIENCE,
  )
})
