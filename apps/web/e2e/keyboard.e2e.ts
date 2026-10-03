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
import {
  barriers,
  ENGINES,
  eventually,
  idle,
  noPlugins,
  restoreState,
  stateIn,
  textOf,
  textsOf,
  watch,
} from './support.js'

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
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
    }, 120_000)

    test('the keys are listed for whoever asks; a table is searched and walked with them', async () => {
      // "?" lists the keys, wherever one is.
      await page.keyboard.press('?')
      const help = page.getByRole('dialog')
      await help.getByTestId('shortcuts').waitFor()
      expect(await textsOf(help.locator('dt'))).toEqual([
        'Search, or jump to a place or an action',
        'Show these shortcuts',
        'Go to Overview',
        'Go to Samples',
        'Go to Plug-ins',
        'Go to History',
        'Go to Settings',
        'Search the table',
        'Next row',
        'Row before',
        'Open the row',
        'Close it',
      ])
      expect(await barriers(page)).toEqual([])
      await page.keyboard.press('Escape')
      await help.waitFor({ state: 'hidden' })

      await page.keyboard.press('g')
      await page.keyboard.press('s')
      await page.getByRole('heading', { level: 1, name: 'Samples', exact: true }).waitFor()
      const rows = page.locator('table tbody tr[data-slot=tr]')
      await rows.first().waitFor()
      const focused = () =>
        page.evaluate(() => {
          const element = document.activeElement
          // A field by its name, a row of the table by its project (after the box to tick it).
          return (
            element?.getAttribute('aria-label') ??
            element?.querySelectorAll('td')[1]?.textContent?.trim()
          )
        })
      // "/" puts the cursor into the search of the table; what is typed there is text, not a key
      // of the app.
      await page.keyboard.press('/')
      expect(await focused()).toBe('Search projects')
      await page.keyboard.type('fixed ?')
      expect(await eventually(() => rows.count(), 0)).toBe(0)
      expect(await page.getByRole('dialog').count()).toBe(0)
      await page.keyboard.press('Backspace')
      expect(await eventually(() => rows.count(), 1)).toBe(1)
      await page.keyboard.press('ControlOrMeta+a')
      await page.keyboard.press('Backspace')
      expect(await eventually(() => rows.count(), 3)).toBe(3)

      // The arrow keys walk the rows, and stop at the ends; Enter opens the row with the focus.
      await rows.first().focus()
      const walked: (string | null | undefined)[] = []
      for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowUp']) {
        await page.keyboard.press(key)
        walked.push(await focused())
      }
      expect(walked).toEqual([
        'Fixed Path Project',
        'VST2toVST3 Project',
        'VST2toVST3 Project',
        'Fixed Path Project',
      ])
      await page.keyboard.press('Enter')
      const panel = page.getByRole('dialog')
      expect(await panel.getByRole('heading', { level: 2 }).innerText()).toBe('Fixed Path Project')
      await page.keyboard.press('Escape')
      await panel.waitFor({ state: 'hidden' })
    }, 60_000)

    test('a run is undone from the history without a mouse, after its question', async () => {
      const set = join(projects, 'Brokenpath Project', 'Brokenpath.als')
      const original = readFileSync(set)
      await page.keyboard.press('g')
      await page.keyboard.press('o')
      await page.getByRole('heading', { level: 1, name: 'Overview' }).waitFor()
      await tabTo('Review and fix')
      await page.keyboard.press('Enter')
      const dialog = page.getByRole('dialog')
      await dialog.getByTestId('review-plan').waitFor()
      await tabTo('Continue')
      await page.keyboard.press('Enter')
      await tabTo('Fix 1 set')
      await page.keyboard.press('Enter')
      await dialog.getByTestId('review-done').waitFor({ timeout: 30_000 })
      await tabTo('Done')
      await page.keyboard.press('Enter')
      await dialog.waitFor({ state: 'hidden' })
      expect(readSet(set)).toContain('Samples/Imported')

      await page.keyboard.press('g')
      await page.keyboard.press('h')
      await page.getByRole('heading', { level: 1, name: 'History', exact: true }).waitFor()
      await page.getByTestId('run').first().waitFor()
      // The fix of the test before was undone: only this one has an undo.
      await tabTo('Undo: Fixed 1 set, copied 1 file')
      await page.keyboard.press('Enter')
      await dialog.getByTestId('undo-lines').waitFor()
      expect(await textOf(dialog.getByRole('heading', { level: 2 }))).toBe('Undo this run?')
      await tabTo('Undo the run')
      await page.keyboard.press('Enter')
      await page.getByTestId('history-undone').waitFor({ timeout: 30_000 })
      expect(readFileSync(set).equals(original)).toBe(true)
      await page.getByTestId('progress').waitFor({ state: 'hidden', timeout: 30_000 })
    }, 120_000)
  })
}
