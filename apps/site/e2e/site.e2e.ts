/**
 * The built site as GitHub Pages serves it: below `/livesaver/`, with the web app beside it.
 * Every page and every link is checked once without a browser; then the landing page, the docs,
 * the search and the way into the app in the three browser engines, with no barrier that axe
 * can find and no request to another address.
 *
 * `LIVESAVER_SITE_URL=https://polobase.github.io/livesaver/ bun run test:site` tests the site
 * that is deployed instead of building one.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Browser, Page } from 'playwright'
import { build as buildApp } from '../../web/build.js'
import {
  barriers,
  ENGINES,
  eventually,
  PATIENCE,
  textOf,
  textsOf,
  watch,
} from '../../web/e2e/support.js'
import { build } from '../build.js'
import { serve } from '../serve.js'

let site: { url: string; stop: () => void }
let origin: string
const deployed = process.env.LIVESAVER_SITE_URL

beforeAll(async () => {
  if (deployed) site = { url: deployed.replace(/\/?$/, '/'), stop: () => {} }
  else {
    await Promise.all([build(), buildApp()])
    site = serve()
  }
  origin = new URL(site.url).origin
}, 300_000 * PATIENCE)
afterAll(() => site?.stop())

/** Other sites the pages may link to; none of them is asked for anything. */
const LINKED = ['bun.sh', 'github.com', 'nodejs.org', 'polobase.github.io']

test(
  'every page is there, and every link and picture on it leads somewhere',
  async () => {
    const pages = new Map<string, string>()
    const links: { from: string; to: URL }[] = []
    const elsewhere = new Set<string>()
    const broken: string[] = []
    const queue = [site.url]
    const plain = (text: string) => text.replaceAll('&amp;', '&')
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      if (pages.has(url)) continue
      const response = await fetch(url)
      const html = (response.headers.get('content-type') ?? '').includes('html')
        ? await response.text()
        : ''
      pages.set(url, html)
      if (!response.ok) broken.push(`${response.status} ${url}`)
      // The app is a set of files of its own: that it is there is enough.
      if (!html || url.startsWith(`${site.url}app/`)) continue
      const found = [
        ...html.matchAll(/<a\b[^>]*?\shref="([^"]+)"/g),
        ...html.matchAll(/<img\b[^>]*?\ssrc="([^"]+)"/g),
      ]
      for (const [, href] of found) {
        const to = new URL(plain(href as string), response.url)
        if (to.origin !== origin) elsewhere.add(to.hostname)
        else {
          links.push({ from: url, to })
          queue.push(`${to.origin}${to.pathname}`)
        }
      }
    }
    // A link to a heading needs the heading.
    for (const { from, to } of links) {
      if (!to.hash) continue
      const html = pages.get(`${to.origin}${to.pathname}`) ?? ''
      if (!html.includes(`id="${decodeURIComponent(to.hash.slice(1))}"`))
        broken.push(`${from} → ${to.pathname}${to.hash}`)
    }
    expect(broken).toEqual([])
    // (The guides name the app by its address on the web, which is this site once it is deployed.)
    expect([...elsewhere].sort()).toEqual(
      LINKED.filter((host) => host !== new URL(origin).hostname),
    )
    const docs = [...pages.keys()].filter(
      (url) => url.startsWith(`${site.url}docs/`) && pages.get(url),
    )
    expect(docs.length).toBeGreaterThanOrEqual(21)
  },
  120_000 * PATIENCE,
)

test(
  'the sitemap names every page by its address on the web, and each is there',
  async () => {
    const sitemap = await (await fetch(`${site.url}sitemap.xml`)).text()
    const addresses = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => match[1] as string,
    )
    const web = 'https://polobase.github.io/livesaver/'
    expect(addresses.slice(0, 3)).toEqual([web, `${web}docs/`, `${web}docs/codemods/`])
    expect(addresses.at(-1)).toBe(`${web}app/`)
    expect(addresses).toHaveLength(23)
    for (const address of addresses) {
      const here = await fetch(address.replace(web, site.url), { redirect: 'manual' })
      expect([address, here.status]).toEqual([address, 200])
    }
    // A page names its own address, with the slash the host serves it with.
    const page = await (await fetch(`${site.url}docs/guide/samples/`)).text()
    expect(page).toContain(`<link rel="canonical" href="${web}docs/guide/samples/">`)
    expect(page).toContain(`content="${web}docs/guide/images/overview-light.webp"`)
  },
  60_000 * PATIENCE,
)

/** Opens a page of the site and waits until its script has taken over: then its buttons work. */
async function open(page: Page, url: string) {
  const response = await page.goto(url)
  await page.locator('html[data-ready=true]').waitFor()
  return response
}

for (const [name, type] of ENGINES) {
  describe(`the site in ${name}`, () => {
    let browser: Browser
    beforeAll(async () => {
      browser = await type.launch()
    }, 60_000 * PATIENCE)
    afterAll(() => browser?.close())

    test(
      'the landing page says what livesaver does, and leads to the guide and into the app',
      async () => {
        const { page, problems, outside } = await watch(browser, origin)
        await open(page, site.url)
        expect(await page.title()).toBe('Your Ableton Live projects, complete again · livesaver')
        expect(await textOf(page.getByRole('heading', { level: 1 }))).toBe(
          'Your Live projects, complete again',
        )
        // The first picture is there, as large as it was taken.
        const hero = page.getByRole('img', { name: /^The overview of livesaver after a scan/ })
        await hero.waitFor()
        const width = () =>
          hero.evaluate((image: HTMLImageElement) => (image.complete ? image.naturalWidth : 0))
        expect(await eventually(width, 2560)).toBe(2560)

        await page.getByRole('link', { name: 'Get livesaver' }).first().click()
        await page.getByRole('heading', { level: 1, name: 'Getting started' }).waitFor()
        expect(page.url()).toBe(`${site.url}docs/guide/getting-started/`)

        await open(page, site.url)
        await page.getByRole('link', { name: 'Open the app' }).first().click()
        await page.getByTestId('where').getByText('In this browser').waitFor()
        expect(page.url().startsWith(`${site.url}app/`)).toBe(true)
        expect(problems).toEqual([])
        expect(outside).toEqual([])
        await page.context().close()
      },
      60_000 * PATIENCE,
    )

    test(
      'a doc is read with its neighbours at hand: the sections, its headings, the next page',
      async () => {
        const { page, problems, outside } = await watch(browser, origin)
        // Asked for without the slash at its end, the host sends the browser to the page with it.
        await open(page, `${site.url}docs/guide/samples`)
        expect(page.url()).toBe(`${site.url}docs/guide/samples/`)
        await page.getByRole('heading', { level: 1, name: 'Fix missing samples' }).waitFor()
        expect(await page.getByRole('heading', { level: 1 }).count()).toBe(1)
        expect(await page.title()).toBe('Fix missing samples · livesaver')

        const docs = page.getByRole('navigation', { name: 'Docs' })
        expect(await textOf(docs.locator('[aria-current=page]'))).toBe('Fix missing samples')
        expect((await textsOf(docs.getByRole('link'))).slice(0, 3)).toEqual([
          'Getting started',
          'Fix missing samples',
          'Samples still missing',
        ])

        // Its pictures are those of the guide, loaded from beside it.
        const pictures = page.locator('main img:visible')
        const count = await pictures.count()
        expect(count).toBe(3)
        for (let i = 0; i < count; i++) {
          // A picture further down is fetched when it comes into view.
          await pictures.nth(i).scrollIntoViewIfNeeded()
          const width = () =>
            pictures
              .nth(i)
              .evaluate((image: HTMLImageElement) => (image.complete ? image.naturalWidth : 0))
          expect(await eventually(width, 2560)).toBe(2560)
        }

        // A heading from the list at the side.
        await page
          .locator('nav', { hasText: 'On this page' })
          .getByRole('link', { name: 'Uncertain matches', exact: true })
          .click()
        const hash = async () => new URL(page.url()).hash
        expect(await eventually(hash, '#uncertain-matches', 5000)).toBe('#uncertain-matches')
        await page.getByRole('heading', { level: 2, name: 'Uncertain matches' }).waitFor()

        // A link written as a file in the Markdown leads to the page; the pages around are offered.
        expect(await page.getByRole('link', { name: 'Edit this page' }).getAttribute('href')).toBe(
          'https://github.com/Polobase/livesaver/edit/main/docs/guide/samples.md',
        )
        await page.getByRole('link', { name: 'Fingerprints', exact: true }).first().click()
        await page.getByRole('heading', { level: 1, name: 'Fingerprints' }).waitFor()
        expect(page.url()).toBe(`${site.url}docs/format/fingerprints/`)
        await page.goBack()
        await page.getByRole('heading', { level: 1, name: 'Fix missing samples' }).waitFor()
        await page
          .getByRole('link', { name: /When samples stay missing/ })
          .last()
          .click()
        await page.getByRole('heading', { level: 1, name: 'When samples stay missing' }).waitFor()
        expect(problems).toEqual([])
        expect(outside).toEqual([])
        await page.context().close()
      },
      60_000 * PATIENCE,
    )

    test(
      'the search finds a page by what it says',
      async () => {
        const { page, problems, outside } = await watch(browser, origin)
        await open(page, `${site.url}docs/`)
        await page.getByRole('heading', { level: 1, name: 'Docs' }).waitFor()
        // What the search looks through is fetched when it is first opened.
        const fetched = page.waitForResponse((response) => response.url().endsWith('/search.json'))
        const dialog = page.getByRole('dialog')
        const field = dialog.getByPlaceholder('Search the docs…')
        const options = dialog.getByRole('option')
        const hit = options.filter({ hasText: 'Fingerprints' }).first()
        const heading = page.getByRole('heading', { level: 1, name: 'Fingerprints' })
        /** Searches, waits until the list of hits stands still, and takes the hit. */
        const search = async () => {
          if (!(await dialog.isVisible()))
            await page
              .getByRole('button', { name: /Search/ })
              .first()
              .click()
          await field.waitFor({ timeout: 5000 * PATIENCE })
          await field.fill('checksum')
          await hit.waitFor({ timeout: 5000 * PATIENCE })
          let before = ''
          for (let same = 0; same < 2; ) {
            const now = (await options.allInnerTexts()).join('|')
            same = now === before ? same + 1 : 0
            before = now
            await page.waitForTimeout(150)
          }
          await hit.click({ timeout: 5000 * PATIENCE })
        }
        // The list is still being made while the first hits are shown: a click that falls into
        // that moment is lost or lands on another hit, as it would for a person, who then
        // searches again.
        for (let tries = 0; tries < 5 && !(await heading.isVisible()); tries++) {
          await search().catch(() => {})
          if (tries === 0) await fetched
          await heading.waitFor({ timeout: 4000 * PATIENCE }).catch(() => {})
        }
        await heading.waitFor()
        expect(page.url().startsWith(`${site.url}docs/format/fingerprints`)).toBe(true)
        expect(problems).toEqual([])
        expect(outside).toEqual([])
        await page.context().close()
      },
      60_000 * PATIENCE,
    )

    test(
      'an address with nothing behind it says so, and leads back',
      async () => {
        const { page, outside } = await watch(browser, origin)
        // The error page is not the app's own frame: there is nothing to wait for but its words.
        const response = await page.goto(`${site.url}docs/guide/nothing-here`)
        expect(response?.status()).toBe(404)
        await page.getByText('There is no page here').waitFor()
        await page.getByRole('link', { name: 'To the guide' }).click()
        await page.getByRole('heading', { level: 1, name: 'Getting started' }).waitFor()
        expect(outside).toEqual([])
        await page.context().close()
      },
      60_000 * PATIENCE,
    )

    test(
      'on a phone, the menu holds the docs',
      async () => {
        const context = await browser.newContext({ viewport: { width: 390, height: 800 } })
        const page = await context.newPage()
        await open(page, `${site.url}docs/guide/samples/`)
        await page.getByRole('heading', { level: 1, name: 'Fix missing samples' }).waitFor()
        // Nothing is wider than the screen.
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true)
        await page.getByRole('button', { name: 'Open menu' }).click()
        await page.getByRole('link', { name: 'History and undo' }).click()
        await page.getByRole('heading', { level: 1, name: 'History and undo' }).waitFor()
        await context.close()
      },
      60_000 * PATIENCE,
    )

    for (const scheme of ['light', 'dark'] as const) {
      test(
        `has no barrier in ${scheme}`,
        async () => {
          const { page } = await watch(browser, origin, scheme)
          for (const path of ['', 'docs/', 'docs/guide/samples/', 'docs/format/fileref/']) {
            await open(page, `${site.url}${path}`)
            await page.getByRole('heading', { level: 1 }).waitFor()
            expect([path, await barriers(page)]).toEqual([path, []])
          }
          await page.context().close()
        },
        120_000 * PATIENCE,
      )
    }
  })
}
