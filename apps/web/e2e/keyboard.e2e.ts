/**
 * The whole way from a scan to an undo with the keyboard alone, in the three browser engines,
 * with livesaver behind the app (on a copy of the fixtures in a temporary folder).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { copyFixtures, readSet, tempDir } from '@livesaver/test-kit'
import { startWeb, type WebServer } from 'livesaver'
import type { Browser, Page } from 'playwright'
import { build, DIST } from '../build.js'
import { ENGINES, idle, noPlugins, restoreState, stateIn, watch } from './support.js'

beforeAll(async () => {
  await build()
}, 120_000)
afterAll(restoreState)

for (const [name, type] of ENGINES) {
  describe(`the keyboard alone in ${name}`, () => {
    let browser: Browser
    let page: Page
    let server: WebServer
    let tmp: { path: string; cleanup: () => void }
    let projects: string

    beforeAll(async () => {
      tmp = tempDir()
      const copied = copyFixtures(tmp.path)
      projects = copied.projects
      stateIn(tmp.path)
      const config = join(tmp.path, 'config.json')
      writeFileSync(
        config,
        JSON.stringify({
          appResources: '',
          vendorLibraries: [],
          searchRoots: [copied.samples],
          status: { projects },
        }),
      )
      server = await startWeb({ assets: DIST, config, force: true, plugins: noPlugins })
      browser = await type.launch()
      ;({ page } = await watch(browser, server.url))
      await page.goto(server.url)
      await page.getByTestId('search-folders').waitFor()
    }, 60_000)
    afterAll(async () => {
      await browser?.close()
      if (server) await idle(server)
      await server?.close()
      tmp?.cleanup()
    })

    /** Presses Tab until the focus is on the control of that name. */
    const tabTo = async (label: string | RegExp) => {
      // WebKit, like Safari, only stops at every control with the Option key held.
      const key = name === 'WebKit' ? 'Alt+Tab' : 'Tab'
      for (let presses = 0; presses < 120; presses++) {
        await page.keyboard.press(key)
        const focused = await page.evaluate(() => {
          const element = document.activeElement
          return (element?.getAttribute('aria-label') || element?.textContent || '').trim()
        })
        if (typeof label === 'string' ? focused === label : label.test(focused)) return
      }
      throw new Error(`The keyboard does not reach "${label}"`)
    }

    test('scans, reviews, fixes and undoes without a mouse', async () => {
      const set = join(projects, 'Brokenpath Project', 'Brokenpath.als')
      const original = readFileSync(set)
      await tabTo('Scan your library')
      await page.keyboard.press('Enter')
      await page.getByTestId('fix-card').waitFor({ timeout: 30_000 })

      await tabTo('Review and fix')
      await page.keyboard.press('Enter')
      const dialog = page.getByRole('dialog')
      await dialog.getByTestId('review-plan').waitFor()
      await tabTo('Continue')
      await page.keyboard.press('Enter')
      await dialog.getByTestId('review-ready').waitFor()
      await tabTo('Fix 1 set')
      await page.keyboard.press('Enter')
      await dialog.getByTestId('review-done').waitFor({ timeout: 30_000 })
      expect(readSet(set)).toContain('Samples/Imported')
      await tabTo('Done')
      await page.keyboard.press('Enter')
      await dialog.waitFor({ state: 'hidden' })

      // The undo waits for the scan that follows a fix: the button can be reached once it is over.
      await page.getByTestId('progress').waitFor({ state: 'hidden', timeout: 30_000 })
      await tabTo('Undo this fix')
      await page.keyboard.press('Enter')
      await page.getByTestId('undone').waitFor({ timeout: 30_000 })
      expect(readFileSync(set).equals(original)).toBe(true)

      // The places by their keys, and a project's panel by Enter on its row.
      await page
        .getByTestId('fix-card')
        .getByText('1 set in 1 project')
        .waitFor({ timeout: 30_000 })
      await page.keyboard.press('g')
      await page.keyboard.press('s')
      await page.getByRole('heading', { level: 1, name: 'Samples', exact: true }).waitFor()
      await page.locator('table tbody tr[data-slot=tr]').first().focus()
      await page.keyboard.press('Enter')
      await page.getByRole('dialog').getByText('What a fix changes (1)').waitFor()
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'hidden' })

      // The palette knows what can be done now, from any place.
      await page.keyboard.press('ControlOrMeta+k')
      await page.getByPlaceholder('Search or jump to…').fill('review')
      await page.locator('[data-highlighted]', { hasText: 'Review and fix' }).waitFor()
      await page.keyboard.press('Enter')
      await page.getByRole('dialog').getByTestId('review-plan').waitFor()
      await page.getByRole('heading', { level: 1, name: 'Overview' }).waitFor()
      await page.keyboard.press('Escape')
    }, 120_000)
  })
}
