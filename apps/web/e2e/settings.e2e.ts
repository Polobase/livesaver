/**
 * The settings with livesaver behind the app, in the three browser engines: what livesaver found
 * on this computer, showing a folder in Finder, the reset to the command line's settings, and
 * what every page says when livesaver is gone.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { copyFixtures, tempDir } from '@livesaver/test-kit'
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
  describe(`the settings in ${name}`, () => {
    let browser: Browser
    let page: Page
    let server: WebServer
    let tmp: { path: string; cleanup: () => void }
    let projects: string
    let samples: string
    let config: string
    let userLibrary: string
    let problems: string[]
    let outside: string[]
    const revealed: string[] = []

    const settings = () => ({
      assets: DIST,
      config,
      force: true,
      plugins: noPlugins,
      reveal: async (path: string) => {
        revealed.push(path)
      },
    })

    beforeAll(async () => {
      tmp = tempDir()
      ;({ projects, samples } = copyFixtures(tmp.path))
      stateIn(tmp.path)
      config = join(tmp.path, 'config.json')
      // Ableton's folders are named, so that the test does not see those of this computer.
      userLibrary = join(tmp.path, 'Ableton', 'User Library')
      mkdirSync(userLibrary, { recursive: true })
      writeFileSync(
        config,
        JSON.stringify({
          userLibrary,
          factoryPacks: join(tmp.path, 'Ableton', 'Factory Packs'),
          appResources: '',
          vendorLibraries: [],
          searchRoots: [samples],
          status: { projects },
        }),
      )
      server = await startWeb(settings())
      browser = await type.launch()
      ;({ page, problems, outside } = await watch(browser, server.url))
      await page.goto(`${server.url}#/settings`)
      await page.getByTestId('found').waitFor()
    }, 60_000)
    afterAll(async () => {
      await browser?.close()
      if (server) await idle(server)
      await server?.close()
      tmp?.cleanup()
    })

    const folderNames = () => page.getByTestId('folder-name').allInnerTexts()
    const packLimit = () => page.getByRole('spinbutton')
    const toasts = () => page.getByRole('region', { name: /^Notifications/ }).locator('li')

    test('it says what livesaver found on this computer, and where it keeps its own files', async () => {
      const found = page.getByTestId('found')
      const labels = await textsOf(found.locator('dt'))
      const values = await textsOf(found.locator('dd > span:first-child'))
      const rows = Object.fromEntries(labels.map((label, i) => [label, values[i]]))
      expect(labels).toEqual([
        'Ableton Live',
        'User Library',
        'Factory Packs',
        'Live’s own content',
        'Settings file',
        'Runs and originals',
      ])
      // What is not there is said, not left out.
      expect(rows).toMatchObject({
        'User Library': userLibrary,
        'Factory Packs': 'not found',
        'Live’s own content': 'not found',
        'Settings file': config,
        'Runs and originals': join(tmp.path, 'home'),
      })
      expect(await textOf(page.locator('#about-title + dl'))).toContain(
        'on this computer, with livesaver behind it',
      )
    }, 30_000)

    test('a folder is shown in Finder from where it is listed', async () => {
      await page
        .getByTestId('folder-row')
        .filter({ hasText: 'samples' })
        .getByRole('button', { name: 'Show in Finder: samples' })
        .click()
      await page.getByTestId('found').getByRole('button', { name: 'Show in Finder: home' }).click()
      const shown = [samples, join(tmp.path, 'home')]
      expect(await eventually(async () => revealed, shown)).toEqual(shown)
    }, 30_000)

    test('a reset goes back to the settings of the command line', async () => {
      expect(await folderNames()).toEqual(['projects', 'samples'])
      // The app starts with the folders and options of its last scan …
      await page.getByRole('button', { name: 'Remove samples' }).click()
      await packLimit().fill('20')
      await packLimit().press('Enter')
      await page.getByTestId('scan').click()
      await page
        .getByTestId('scanned-at')
        .getByText(/^Scanned/)
        .waitFor({ timeout: 30_000 })
      await page.reload()
      await page.getByTestId('found').waitFor()
      expect(await folderNames()).toEqual(['projects'])
      expect(await packLimit().inputValue()).toBe('20')

      // … until it is reset: then the settings count again, and the scan is of other folders.
      await page.getByTestId('reset-settings').click()
      await toasts().filter({ hasText: 'are those of your settings again' }).waitFor()
      expect(await folderNames()).toEqual(['projects', 'samples'])
      expect(await packLimit().inputValue()).toBe('50')
      expect(await textOf(page.getByTestId('scanned-at'))).toMatch(/^Changed since the scan/)
      expect(await barriers(page)).toEqual([])
      await page.reload()
      await page.getByTestId('found').waitFor()
      expect(await folderNames()).toEqual(['projects', 'samples'])
      expect(await packLimit().inputValue()).toBe('50')
    }, 60_000)

    test('when livesaver is gone, every page says so and what to do', async () => {
      const gone = await startWeb(settings())
      const lost = await watch(browser, gone.url)
      await lost.page.goto(gone.url)
      await lost.page.getByTestId('scan-library').waitFor()
      await idle(gone)
      await gone.close()
      await lost.page.getByTestId('scan-library').click()
      const alert = lost.page.getByTestId('engine-problem')
      await alert.waitFor()
      expect(await textOf(alert)).toContain('livesaver on this computer does not answer.')
      expect(await textOf(alert)).toContain('start it again with “livesaver web”')
      // It is not a matter of one page: nothing works anywhere until it is back.
      await lost.page.getByRole('link', { name: 'History', exact: true }).click()
      await lost.page.getByRole('heading', { level: 1, name: 'History', exact: true }).waitFor()
      await alert.getByRole('button', { name: 'Reload this page' }).waitFor()
      expect(await lost.page.getByTestId('no-runs').count()).toBe(0)
      expect(await barriers(lost.page)).toEqual([])
      await lost.page.context().close()
    }, 60_000)

    test('a page from an earlier start of livesaver says so', async () => {
      const earlier = await watch(browser, server.url)
      // A livesaver that was started again does not know the token of this page.
      await earlier.page.route(`${server.url}api/**`, (route) =>
        route.fulfill({ status: 403, json: { message: 'not allowed' } }),
      )
      await earlier.page.goto(server.url)
      const alert = earlier.page.getByTestId('engine-problem')
      await alert.waitFor()
      expect(await textOf(alert)).toContain('This page is from an earlier start of livesaver.')
      await earlier.page.context().close()
    }, 30_000)

    test('the page reported no errors, and asked nothing outside its own address', () => {
      expect(problems).toEqual([])
      expect(outside).toEqual([])
    })
  })
}
