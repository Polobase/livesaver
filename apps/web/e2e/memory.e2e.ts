/**
 * The folders of a page across a reload, with the browser's own database. In every engine the
 * lists come back with what was typed and ticked, and a folder that was uploaded is added
 * again. In Chromium a folder behind a handle is read again: a project folder chosen for
 * editing (it lies in the browser's own file system here, see `handed.ts`), and a folder of the
 * disk that was dropped, which the test browser wants to be asked for again and then refuses.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { copyFixtures, tempDir, writeFile } from '@livesaver/test-kit'
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright'
import { build } from '../build.js'
import { serve } from '../serve.js'
import { fill, handOut } from './handed.js'
import {
  barriers,
  dropFolder,
  ENGINES,
  eventually,
  giveFolder,
  PATIENCE,
  textOf,
  type Watched,
  watch,
  watchIn,
} from './support.js'

let site: { url: string; stop: () => void }
beforeAll(async () => {
  await build()
  site = serve()
}, 120_000 * PATIENCE)
afterAll(() => site?.stop())

const rowsOf = (page: Page, list: string) => page.getByTestId(list).getByTestId('folder-row')
const names = (page: Page, list: string) =>
  rowsOf(page, list).getByTestId('folder-name').allInnerTexts()
/** The page as it is after a reload, with its lists on the screen. */
async function reload(page: Page): Promise<void> {
  await page.reload()
  await page.getByTestId('search-folders').waitFor()
}

for (const [name, type] of ENGINES) {
  describe(`the folders of a page after a reload in ${name}`, () => {
    let browser: Browser
    let watched: Watched
    let page: Page
    let tmp: { path: string; cleanup: () => void }
    let projects: string
    let samples: string

    beforeAll(async () => {
      tmp = tempDir()
      ;({ projects, samples } = copyFixtures(tmp.path))
      browser = await type.launch()
      watched = await watch(browser, site.url)
      page = watched.page
      await page.goto(site.url)
      await page.getByTestId('search-folders').waitFor()
    }, 60_000 * PATIENCE)
    afterAll(async () => {
      await browser?.close()
      tmp?.cleanup()
    })

    test(
      'the lists come back with what was typed and ticked; an uploaded folder waits to be added again',
      async () => {
        await giveFolder(page, 'projects-input', projects)
        await giveFolder(page, 'search-input', samples)
        const sample = rowsOf(page, 'search-folders').first()
        await sample.getByRole('button', { name: 'Set path' }).click()
        await sample.getByRole('textbox').fill('/Volumes/Disk/samples')
        await sample.getByRole('button', { name: 'Done' }).click()
        await sample.getByRole('checkbox', { name: 'Contains installed libraries' }).check()
        await page.getByRole('switch', { name: /Also accept a library file/ }).click()
        expect(await textOf(page.getByTestId('kept-note'))).toContain(
          'This browser keeps the list of your folders for your next visit, with what you typed and ticked.',
        )

        await reload(page)
        expect([
          await names(page, 'projects-folders'),
          await names(page, 'search-folders'),
        ]).toEqual([['projects'], ['samples']])
        const kept = rowsOf(page, 'search-folders').first()
        expect(await textOf(kept.getByTestId('folder-waits'))).toBe(
          'From your last visit: add it again, by the dialog or a drop. A browser hands a page such a folder for one visit. What you typed and ticked for it is kept.',
        )
        expect(await textOf(kept.getByTestId('folder-path'))).toBe('/Volumes/Disk/samples')
        expect(
          await kept.getByRole('checkbox', { name: 'Contains installed libraries' }).isChecked(),
        ).toBe(true)
        // How a scan matches is kept as well.
        expect(
          await page.getByRole('switch', { name: /Also accept a library file/ }).isChecked(),
        ).toBe(true)
        // Nothing can be scanned before a project folder is there again.
        expect(await page.getByTestId('scan-library').isDisabled()).toBe(true)
        expect(await barriers(page)).toEqual([])
      },
      60_000 * PATIENCE,
    )

    test(
      'added again, a folder takes its place with its settings, and the scan runs',
      async () => {
        await giveFolder(page, 'search-input', samples)
        await giveFolder(page, 'projects-input', projects)
        expect([
          await names(page, 'projects-folders'),
          await names(page, 'search-folders'),
        ]).toEqual([['projects'], ['samples']])
        const row = rowsOf(page, 'search-folders').first()
        expect(await row.getByTestId('folder-waits').count()).toBe(0)
        expect(await textOf(row.getByTestId('folder-path'))).toBe('/Volumes/Disk/samples')
        expect(
          await row.getByRole('checkbox', { name: 'Contains installed libraries' }).isChecked(),
        ).toBe(true)
        await page.getByTestId('scan-library').click()
        await page
          .getByTestId('fix-card')
          .getByText('1 set in 1 project')
          .waitFor({ timeout: 30_000 * PATIENCE })
      },
      60_000 * PATIENCE,
    )

    test(
      'a folder that is removed is forgotten',
      async () => {
        await page.getByRole('link', { name: 'Settings', exact: true }).click()
        await rowsOf(page, 'search-folders')
          .first()
          .getByRole('button', { name: 'Remove samples' })
          .click()
        await reload(page)
        expect([
          await names(page, 'projects-folders'),
          await names(page, 'search-folders'),
        ]).toEqual([['projects'], []])
        expect(watched.problems).toEqual([])
        expect(watched.outside).toEqual([])
      },
      60_000 * PATIENCE,
    )
  })
}

describe('folders behind a handle are read again (Chromium, in a profile that is kept)', () => {
  let context: BrowserContext
  let watched: Watched
  let page: Page
  let tmp: { path: string; cleanup: () => void }
  let projects: string
  let samples: string

  beforeAll(async () => {
    tmp = tempDir()
    ;({ projects, samples } = copyFixtures(tmp.path))
    // A context of Playwright is a private window, which hands a kept handle back to no page
    // (see below): this is a profile as a browser normally has it.
    context = await chromium.launchPersistentContext(join(tmp.path, 'profile'), {
      viewport: { width: 1280, height: 800 },
      timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
    watched = await watchIn(context, site.url)
    page = watched.page
    await handOut(page)
    await page.addInitScript(() => localStorage.setItem('livesaver:fix-in-browser', 'on'))
    await page.goto(site.url)
    await fill(page, projects)
  }, 60_000 * PATIENCE)
  afterAll(async () => {
    await context?.close()
    tmp?.cleanup()
  })

  test(
    'a project folder chosen for editing is there again, and scanned without being added',
    async () => {
      await page.getByTestId('projects-folders').getByRole('button', { name: 'Add folder' }).click()
      await rowsOf(page, 'projects-folders').first().waitFor()
      expect(await textOf(page.getByTestId('kept-note'))).toContain(
        'A folder you dropped here, or chose for editing, is read again then; a sample folder you chose with “Add folder” has to be added again.',
      )
      // (The browser's database takes a moment to take the handle.)
      await page.waitForTimeout(300)

      await reload(page)
      const row = rowsOf(page, 'projects-folders').first()
      await row.getByText('This page may edit it: it can be fixed here.').waitFor()
      expect(await row.getByTestId('folder-waits').count()).toBe(0)
      await page.getByTestId('scan-library').click()
      await page.locator('#headline').waitFor({ timeout: 30_000 * PATIENCE })
      expect(await page.locator('#headline').innerText()).toBe('2 of 3 sets are complete')
    },
    60_000 * PATIENCE,
  )

  test(
    'a dropped folder of the disk is kept; the browser is asked before it is read again',
    async () => {
      await page.getByRole('link', { name: 'Settings', exact: true }).click()
      await dropFolder(page, page.getByTestId('search-folders'), samples)
      await rowsOf(page, 'search-folders').first().waitFor()
      await page.waitForTimeout(300)
      await reload(page)
      const row = rowsOf(page, 'search-folders').first()
      // The test browser allows nothing when asked. A person is asked by their browser, and may
      // allow it for every visit.
      expect(await textOf(row.getByTestId('folder-waits'))).toContain(
        'From your last visit. Your browser wants to be asked before this page reads it again.',
      )
      const notice = page.getByTestId('asleep')
      expect(await textOf(notice)).toBe(
        '1 folder from your last visit Your browser kept it for this page, and wants to be asked before the page reads it again. Allow it',
      )
      expect(await barriers(page)).toEqual([])
      await notice.getByRole('button', { name: 'Allow it' }).click()
      const refused = '1 folder from your last visit Your browser did not allow “samples”. Allow it'
      expect(await eventually(() => textOf(notice), refused)).toBe(refused)
      // It is not scanned while it waits; the project folder is, as before.
      await page.getByRole('link', { name: 'Overview', exact: true }).click()
      await page.getByTestId('scan').click()
      await page.locator('#headline').waitFor({ timeout: 30_000 * PATIENCE })
    },
    60_000 * PATIENCE,
  )

  test(
    'a dropped folder with names a kept folder would hide is to be dropped again, and says why',
    async () => {
      const odd = join(tmp.path, 'Odd')
      writeFile(join(odd, 'Claps:Snares', 'clap.wav'), 'RIFF')
      writeFile(join(odd, 'Kick.wav'), 'RIFF')
      await page.getByRole('link', { name: 'Settings', exact: true }).click()
      await dropFolder(page, page.getByTestId('search-folders'), odd)
      const row = rowsOf(page, 'search-folders').nth(1)
      await row.waitFor()
      // Dropped, it is read in full: both files.
      expect(await textOf(row.getByTestId('folder-facts'))).toBe('2 files')
      await reload(page)
      expect(await textOf(row.getByTestId('folder-waits'))).toBe(
        'From your last visit: add it again, by the dialog or a drop. Your browser would keep it, but would then not show 1 of its files (it hides some names from a folder it keeps). What you typed and ticked for it is kept.',
      )
      expect(watched.outside).toEqual([])
    },
    60_000 * PATIENCE,
  )
})

describe('in a private window no handle is kept (Chromium)', () => {
  let browser: Browser
  let page: Page
  let tmp: { path: string; cleanup: () => void }

  beforeAll(async () => {
    tmp = tempDir()
    const { projects } = copyFixtures(tmp.path)
    browser = await chromium.launch()
    // A context of Playwright is a private window. Chromium takes a handle into its database
    // there and never answers when the handle is asked back, and from then on the page gets no
    // answer to anything about folders: the page must not get there.
    ;({ page } = await watch(browser, site.url))
    await handOut(page)
    await page.addInitScript(() => localStorage.setItem('livesaver:fix-in-browser', 'on'))
    await page.goto(site.url)
    await fill(page, projects)
  }, 60_000 * PATIENCE)
  afterAll(async () => {
    await browser?.close()
    tmp?.cleanup()
  })

  test(
    'the page comes up at once after a reload, asks for the folder again, and can take it',
    async () => {
      await page.getByTestId('projects-folders').getByRole('button', { name: 'Add folder' }).click()
      await rowsOf(page, 'projects-folders').first().waitFor()
      await page.waitForTimeout(300)
      const started = Date.now()
      await reload(page)
      const row = rowsOf(page, 'projects-folders').first()
      await row.waitFor()
      // (It did not wait for a browser that does not answer.)
      expect(Date.now() - started).toBeLessThan(1500 * PATIENCE)
      expect(await textOf(row.getByTestId('folder-waits'))).toContain(
        'From your last visit: add it again, by the dialog or a drop.',
      )
      // The browser still answers the page: the folder is chosen again, and scanned.
      await page.getByTestId('projects-folders').getByRole('button', { name: 'Add folder' }).click()
      await row.getByText('This page may edit it: it can be fixed here.').waitFor()
      expect(await names(page, 'projects-folders')).toEqual(['projects'])
      await page.getByTestId('scan-library').click()
      await page.locator('#headline').waitFor({ timeout: 30_000 * PATIENCE })
    },
    60_000 * PATIENCE,
  )
})
