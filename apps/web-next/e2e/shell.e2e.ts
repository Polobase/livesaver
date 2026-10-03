/**
 * The app's shell in the three browser engines: it loads from plain files, the places can be
 * reached by click and by keyboard, it asks nothing outside its own address, and it has no
 * barrier that axe can find, in light and in dark.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Browser } from 'playwright'
import { build } from '../build.js'
import { serve } from '../serve.js'
import { barriers, ENGINES, watch } from './support.js'

let server: { url: string; stop: () => void }

beforeAll(async () => {
  await build()
  server = serve()
}, 120_000)
afterAll(() => server?.stop())

for (const [name, type] of ENGINES) {
  describe(`the shell in ${name}`, () => {
    let browser: Browser
    beforeAll(async () => {
      browser = await type.launch()
    }, 60_000)
    afterAll(() => browser?.close())

    test('loads, and every place is reached from the sidebar', async () => {
      const { page, problems, outside } = await watch(browser, server.url)
      await page.goto(server.url)
      await page.getByRole('heading', { level: 1, name: 'Overview' }).waitFor()
      for (const place of ['Samples', 'Plug-ins', 'History', 'Settings', 'Overview']) {
        await page.getByRole('link', { name: place, exact: true }).click()
        await page.getByRole('heading', { level: 1, name: place, exact: true }).waitFor()
      }
      expect(page.url()).toBe(`${server.url}#/`)
      expect(problems).toEqual([])
      expect(outside).toEqual([])
      await page.context().close()
    }, 60_000)

    test('the keyboard reaches the places, and the palette finds them', async () => {
      const { page, problems } = await watch(browser, server.url)
      await page.goto(server.url)
      await page.getByRole('heading', { level: 1, name: 'Overview' }).waitFor()
      await page.keyboard.press('g')
      await page.keyboard.press('s')
      await page.getByRole('heading', { level: 1, name: 'Samples', exact: true }).waitFor()
      await page.keyboard.press('ControlOrMeta+k')
      await page.getByPlaceholder('Search or jump to…').fill('hist')
      // The palette filters a moment after typing; Enter takes what is highlighted then.
      await page.locator('[data-highlighted]', { hasText: 'History' }).waitFor()
      await page.keyboard.press('Enter')
      await page.getByRole('heading', { level: 1, name: 'History', exact: true }).waitFor()
      expect(problems).toEqual([])
      await page.context().close()
    }, 60_000)

    for (const scheme of ['light', 'dark'] as const) {
      test(`has no barrier in ${scheme}`, async () => {
        const { page } = await watch(browser, server.url, scheme)
        await page.goto(server.url)
        await page.getByRole('heading', { level: 1, name: 'Overview' }).waitFor()
        expect(await barriers(page)).toEqual([])
        await page.context().close()
      }, 60_000)
    }
  })
}
