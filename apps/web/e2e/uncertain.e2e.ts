/**
 * A library with more than the fixtures have: an uncertain match, samples missing from several
 * kinds of sources, a set that cannot be read. With livesaver behind the app, in Chromium.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { demoLibrary, tempDir } from '@livesaver/test-kit'
import { startWeb, type WebServer } from 'livesaver'
import { type Browser, chromium, type Page } from 'playwright'
import { build, DIST } from '../build.js'
import {
  barriers,
  closeWith,
  idle,
  noPlugins,
  PATIENCE,
  restoreState,
  stateIn,
  textOf,
  textsOf,
  watch,
} from './support.js'

beforeAll(async () => {
  await build()
}, 120_000 * PATIENCE)
afterAll(restoreState)

describe('a library with uncertain matches (Chromium)', () => {
  let browser: Browser
  let page: Page
  let server: WebServer
  let tmp: { path: string; cleanup: () => void }

  beforeAll(async () => {
    tmp = tempDir()
    const demo = demoLibrary(tmp.path)
    stateIn(tmp.path)
    const config = join(tmp.path, 'config.json')
    writeFileSync(
      config,
      JSON.stringify({
        appResources: '',
        vendorLibraries: [demo.library],
        searchRoots: [demo.samples, demo.library],
        status: { projects: demo.projects },
      }),
    )
    server = await startWeb({ assets: DIST, config, liveRunning: () => false, plugins: noPlugins })
    browser = await chromium.launch()
    ;({ page } = await watch(browser, server.url))
    await page.goto(server.url)
    await page.getByTestId('search-folders').waitFor()
  }, 60_000 * PATIENCE)
  afterAll(async () => {
    await browser?.close()
    if (server) await idle(server)
    await server?.close()
    tmp?.cleanup()
  })

  test(
    'the settings of the command line fill in the folders, and the vendor folder is marked',
    async () => {
      expect(await page.getByTestId('folder-name').allInnerTexts()).toEqual([
        'Projects',
        'Samples',
        'Native Instruments',
      ])
      const library = page.getByTestId('folder-row').filter({ hasText: 'Native Instruments' })
      expect(await library.getByRole('checkbox').isChecked()).toBe(true)
    },
    30_000 * PATIENCE,
  )

  test(
    'the review says what a fix does with the uncertain matches and without',
    async () => {
      await page.getByTestId('scan-library').click()
      await page.getByTestId('fix-card').waitFor({ timeout: 30_000 * PATIENCE })
      // A sample of the installed library was re-saved by its vendor: nothing confirms it, so
      // it counts as missing. The scan says that it is there, and takes it when asked.
      expect(await textOf(page.getByTestId('fix-card'))).not.toContain('Uncertain matches')
      const hint = page.getByTestId('missing-card').getByTestId('library-files')
      expect(await textOf(hint)).toContain(
        '1 of these is in your installed libraries, at the same place and under the same name, but re-saved by its vendor',
      )
      expect(await barriers(page)).toEqual([])
      await hint.getByTestId('take-library-files').click()
      await page
        .getByTestId('fix-card')
        .getByText('Uncertain matches')
        .waitFor({ timeout: 30_000 * PATIENCE })
      expect(await page.getByTestId('library-files').count()).toBe(0)
      expect(await textOf(page.getByTestId('fix-card'))).toContain('Uncertain matches 1')
      await page.getByTestId('review').click()
      const dialog = page.getByRole('dialog')
      const numbers = () => textsOf(dialog.getByTestId('review-plan').locator('dl dd'))
      const withThem = await numbers()
      await dialog.getByRole('switch', { name: 'Leave out the 1 uncertain match' }).click()
      const without = await numbers()
      // One reference and one copy fewer; the set of the uncertain match still changes for its
      // other sample.
      expect([
        Number(withThem[1]) - Number(without[1]),
        Number(withThem[2]) - Number(without[2]),
      ]).toEqual([1, 1])
      expect(withThem[0]).toBe(without[0] as string)
      expect(await textOf(dialog)).toContain('stay missing')
      await dialog.getByTestId('review-continue').click()
      await dialog.getByTestId('review-apply').click()
      await dialog.getByTestId('review-done').waitFor({ timeout: 30_000 * PATIENCE })
      await closeWith(dialog, dialog.getByTestId('review-done'))
      // The uncertain match was left alone: it is still there to fix.
      await page
        .getByTestId('fixable')
        .getByText('1 set in 1 project')
        .waitFor({ timeout: 30_000 * PATIENCE })
      expect(await textOf(page.getByTestId('fix-card'))).toContain('Uncertain matches 1')
    },
    60_000 * PATIENCE,
  )

  test(
    'missing samples are grouped by where they came from, each with what to do',
    async () => {
      await page.getByRole('link', { name: 'See all missing samples' }).click()
      const groups = page.getByTestId('missing-groups').locator(':scope > li')
      await groups.first().waitFor()
      const starts = [
        'Vintage Heat LibraryNI expansionInstall it in Native Access',
        '/Volumes/Old Drive/Sample Packs/Vintage BreaksFolderFind this folder or drive',
        'Drum EssentialsAbleton packInstall the pack in Live',
        'Samples/OldUser Library (old)They were in an older User Library',
      ]
      expect(
        (await textsOf(groups)).map((group, i) => group.startsWith(starts[i] as string)),
      ).toEqual([true, true, true, true])
      // Where a folder is what helps, it can be added right there.
      expect(await groups.nth(1).getByRole('button', { name: 'Add its folder' }).count()).toBe(1)
      expect(await groups.nth(0).getByRole('button', { name: 'Add its folder' }).count()).toBe(0)
      await page.getByLabel('Search missing samples').fill('break')
      expect(await page.getByTestId('shown').innerText()).toBe('2 of 7')
      expect(await barriers(page)).toEqual([])
    },
    30_000 * PATIENCE,
  )
})
