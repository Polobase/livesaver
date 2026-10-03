/**
 * The app from one address, connected to livesaver at another: what `livesaver web --pair` does
 * for the app on livesaver's site. In the three browser engines, with a fix and its undo on a
 * temporary copy of the fixtures. (Both addresses are this computer here; that a browser lets a
 * public site reach this computer at all is its own decision, and not one a test can make.)
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { copyFixtures, readSet, tempDir } from '@livesaver/test-kit'
import { pairingLink, startWeb, type WebServer } from 'livesaver'
import type { Browser } from 'playwright'
import { build } from '../build.js'
import { serve } from '../serve.js'
import {
  barriers,
  ENGINES,
  idle,
  noPlugins,
  PATIENCE,
  restoreState,
  stateIn,
  textOf,
  watch,
} from './support.js'

beforeAll(async () => {
  await build()
}, 120_000 * PATIENCE)
afterAll(restoreState)

for (const [name, type] of ENGINES) {
  describe(`a page connected to livesaver in ${name}`, () => {
    let browser: Browser
    /** The app as plain files at one address: on its own, it is a page that only reads. */
    let site: { url: string; stop: () => void }
    /** livesaver at another address, which lets the pages of that one in. */
    let server: WebServer
    let tmp: { path: string; cleanup: () => void }
    let projects: string
    let config: string

    beforeAll(async () => {
      site = serve()
      tmp = tempDir()
      const copied = copyFixtures(tmp.path)
      projects = copied.projects
      stateIn(tmp.path)
      config = join(tmp.path, 'config.json')
      writeFileSync(
        config,
        JSON.stringify({
          appResources: '',
          vendorLibraries: [],
          searchRoots: [copied.samples],
          status: { projects },
        }),
      )
      server = await startWeb({
        assets: false,
        config,
        liveRunning: () => false,
        plugins: noPlugins,
        pair: new URL(site.url).origin,
      })
      browser = await type.launch()
    }, 60_000 * PATIENCE)
    afterAll(async () => {
      await browser?.close()
      if (server) await idle(server)
      await server?.close()
      site?.stop()
      tmp?.cleanup()
    })

    const set = () => join(projects, 'Brokenpath Project', 'Brokenpath.als')

    test(
      'the pairing link opens the app connected: it reads this computer, fixes and undoes',
      async () => {
        const { page, problems, outside } = await watch(browser, site.url)
        const original = readFileSync(set())
        await page.goto(pairingLink(site.url, server.url, server.token))
        await page.getByTestId('where').getByText('On this computer').waitFor()
        // The token is no longer in the address, where it could be seen or bookmarked.
        expect(page.url()).toBe(`${site.url}#/`)
        // The folders are those of this computer's settings, by their paths.
        await page.getByTestId('folder-row').first().waitFor()
        expect(await page.getByTestId('folder-name').allInnerTexts()).toEqual([
          'projects',
          'samples',
        ])

        await page.getByTestId('where').click()
        const where = page.getByRole('dialog')
        expect(await textOf(where)).toContain(
          'In this page, connected to livesaver on this computer.',
        )
        expect(await textOf(where)).toContain(`The page comes from ${new URL(site.url).origin}`)
        expect(await barriers(page)).toEqual([])
        await page.keyboard.press('Escape')
        await where.waitFor({ state: 'hidden' })

        await page.getByTestId('scan-library').click()
        await page.getByTestId('fix-card').getByText('1 set in 1 project').waitFor()
        await page.getByTestId('review').click()
        const dialog = page.getByRole('dialog')
        await dialog.getByTestId('review-continue').click()
        await dialog.getByRole('button', { name: 'Fix 1 set' }).click()
        await dialog.getByTestId('review-done').waitFor({ timeout: 30_000 * PATIENCE })
        await dialog.getByTestId('review-done').click()
        await dialog.waitFor({ state: 'hidden' })
        expect(readSet(set())).toContain('Samples/Imported')
        // The undo waits for the scan that follows a fix.
        await page.getByTestId('progress').waitFor({ state: 'hidden', timeout: 30_000 * PATIENCE })
        await page.getByTestId('fixed').getByRole('button', { name: 'Undo this fix' }).click()
        await page.getByTestId('undone').waitFor({ timeout: 30_000 * PATIENCE })
        expect(readFileSync(set()).equals(original)).toBe(true)
        await page.getByTestId('progress').waitFor({ state: 'hidden', timeout: 30_000 * PATIENCE })

        // A reload stays connected: the pairing is kept for the tab.
        await page.reload()
        await page.getByTestId('where').getByText('On this computer').waitFor()
        await page.getByTestId('fix-card').getByText('1 set in 1 project').waitFor()

        // Disconnected, it is a page on its own again; so is a tab that was opened without the link.
        await page.getByTestId('where').click()
        await page.getByTestId('disconnect').click()
        await page.getByTestId('where').getByText('In this browser').waitFor()
        expect(await page.getByTestId('folder-row').count()).toBe(0)
        const plain = await page.context().newPage()
        await plain.goto(site.url)
        await plain.getByTestId('where').getByText('In this browser').waitFor()

        expect(problems).toEqual([])
        // The page asked its own address and the livesaver it was paired with, and nobody else.
        expect(outside.filter((url) => !url.startsWith(server.url))).toEqual([])
        await page.context().close()
      },
      120_000 * PATIENCE,
    )

    test(
      'a livesaver that was not started for pairing does not let the page in, and the page says what to do',
      async () => {
        const closed = await startWeb({ assets: false, config, liveRunning: () => false })
        const { page } = await watch(browser, site.url)
        await page.goto(pairingLink(site.url, closed.url, closed.token))
        const alert = page.getByTestId('engine-problem')
        await alert.waitFor()
        expect(await textOf(alert)).toContain('livesaver on this computer does not answer.')
        expect(await textOf(alert)).toContain('start it again with “livesaver web --pair”')
        await alert.getByRole('button', { name: 'Use this page on its own' }).click()
        await page.getByTestId('where').getByText('In this browser').waitFor()
        expect(await page.getByTestId('engine-problem').count()).toBe(0)
        await page.context().close()
        await closed.close()
      },
      60_000 * PATIENCE,
    )

    test(
      'a livesaver that is older or newer than the page says so',
      async () => {
        const { page } = await watch(browser, site.url)
        await page.route(`${server.url}api/info`, async (route) => {
          const response = await route.fetch()
          await route.fulfill({ response, json: { ...(await response.json()), api: 99 } })
        })
        await page.goto(pairingLink(site.url, server.url, server.token))
        const alert = page.getByTestId('engine-problem')
        await alert.waitFor()
        expect(await textOf(alert)).toContain('do not fit together: one of them is newer')
        await page.context().close()
      },
      60_000 * PATIENCE,
    )
  })
}
