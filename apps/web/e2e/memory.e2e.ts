/**
 * The folders of a page across a reload, with the browser's own database. In every engine the
 * lists come back with what was typed and ticked, and a folder that was uploaded is added
 * again. In Chromium a folder behind a handle is read again: a project folder chosen for
 * editing (it lies in the browser's own file system here, see `handed.ts`), and a folder of the
 * disk that was dropped, which the test browser wants to be asked for again and then refuses.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { liveCrc } from '@livesaver/core'
import {
  copyFixtures,
  deviceSet,
  makeProject,
  tempDir,
  writeFile,
  writeSet,
} from '@livesaver/test-kit'
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
        // (Chromium hands out a handle with a drop, which a page can keep: the row says so.)
        expect(await textOf(kept.getByTestId('folder-waits'))).toBe(
          name === 'Chromium'
            ? 'From your last visit: add it again, by the dialog or a drop. A folder chosen in the dialog is handed to a page for one visit; one you drop here, your browser keeps for your next visit. What you typed and ticked for it is kept.'
            : 'From your last visit: add it again, by the dialog or a drop. A browser hands a page such a folder for one visit. What you typed and ticked for it is kept.',
        )
        // It is said at the top as well: a scan must not be made without them unnoticed.
        expect(await textOf(page.getByTestId('absent'))).toBe(
          '2 folders from your last visit have to be added again “projects”, “samples”. A browser hands a page such a folder for one visit. Add them again, by the dialog or a drop: several folders can be dropped at once. Until then a scan does not read them: a sample that lies there counts as not found, and sets in them are not checked.',
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
        expect(await page.getByTestId('absent').count()).toBe(0)
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
    'a scan without a sample folder of the last visit says so, wherever its result is read',
    async () => {
      // A project whose sample lies in the sample folder and nowhere else.
      const hat = new TextEncoder().encode('RIFF a hat of a drive that is gone')
      const extra = join(tmp.path, 'extra')
      writeSet(
        join(makeProject(extra, 'Song'), 'Song.als'),
        deviceSet('/Volumes/Gone/Loops/hat.wav', hat.length, liveCrc(hat), {
          relPath: '../../../Volumes/Gone/Loops/hat.wav',
        }).replaceAll('MxPatchRef', 'SampleRef'),
      )
      writeFile(join(samples, 'Loops', 'hat.wav'), hat)
      await fill(page, extra)
      // The sample folder is chosen in the dialog: handed over for this visit only.
      await page.getByRole('link', { name: 'Settings', exact: true }).click()
      await giveFolder(page, 'search-input', samples)
      await page.getByTestId('scan').click()
      await page.getByRole('link', { name: 'Overview', exact: true }).click()
      // With the sample folder, every set is complete or can be fixed.
      const whole = '2 of 4 sets are complete'
      expect(await eventually(() => page.locator('#headline').innerText(), whole)).toBe(whole)
      expect(await textOf(page.getByTestId('missing-card'))).toContain('Nothing')
      expect(await page.getByTestId('not-read').count()).toBe(0)

      // After a reload the project folder is back, the sample folder is not: the page says so
      // where the folders are, and a scan made all the same says it on every page.
      await page.waitForTimeout(300)
      await reload(page)
      expect(await textOf(page.getByTestId('absent'))).toContain(
        '1 folder from your last visit has to be added again “samples”.',
      )
      expect(await page.getByTestId('not-read').count()).toBe(0)
      await page.getByTestId('scan-library').click()
      await page.locator('#headline').waitFor({ timeout: 30_000 * PATIENCE })
      const notice = page.getByTestId('not-read')
      expect(await textOf(notice)).toBe(
        'This scan did not read 1 folder from your last visit “samples”. Samples that lie in it count as not found here. In the Settings, let the page read it again (its row says how), then scan again. To the folders',
      )
      expect(await barriers(page)).toEqual([])
      // The sample that lies in it is "not found": its panel says why that may be.
      await page.getByRole('link', { name: 'Samples', exact: true }).click()
      await notice.waitFor()
      await page.getByRole('cell', { name: 'Song Project', exact: true }).click()
      const panel = page.getByRole('dialog')
      await panel.getByText('No file of this name is in the folders that were searched.').waitFor()
      expect(await textOf(panel.getByTestId('not-read-line'))).toBe(
        '1 folder from your last visit was not read by this scan: a sample that lies in it counts as not found.',
      )
      await page.keyboard.press('Escape')
      await panel.waitFor({ state: 'hidden' })

      // The notice leads to the folders; added again, the folder is read and the notice gone.
      await notice.getByRole('link', { name: 'To the folders' }).click()
      await page.getByTestId('absent').waitFor()
      expect(await page.getByTestId('not-read').count()).toBe(0)
      await giveFolder(page, 'search-input', samples)
      expect(await page.getByTestId('absent').count()).toBe(0)
      await page.getByTestId('scan').click()
      await page.getByRole('link', { name: 'Overview', exact: true }).click()
      await page
        .getByTestId('missing-card')
        .getByText('Nothing')
        .waitFor({ timeout: 30_000 * PATIENCE })
      expect(await page.getByTestId('not-read').count()).toBe(0)
      // (For the tests that follow: without the folder that is handed over for one visit.)
      await page.getByRole('link', { name: 'Settings', exact: true }).click()
      await rowsOf(page, 'search-folders')
        .first()
        .getByRole('button', { name: 'Remove samples' })
        .click()
    },
    90_000 * PATIENCE,
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
      // It is not scanned while it waits; the project folder is, as before. The scan says so.
      await page.getByRole('link', { name: 'Overview', exact: true }).click()
      await page.getByTestId('scan').click()
      await page.locator('#headline').waitFor({ timeout: 30_000 * PATIENCE })
      expect(await textOf(page.getByTestId('not-read'))).toContain(
        'This scan did not read 1 folder from your last visit “samples”.',
      )
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
      await page.waitForTimeout(300)
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

describe('a folder that arrives before the folders of the last visit are back (Chromium)', () => {
  let browser: Browser
  let page: Page
  let tmp: { path: string; cleanup: () => void }
  let projects: string
  let samples: string

  beforeAll(async () => {
    tmp = tempDir()
    ;({ projects, samples } = copyFixtures(tmp.path))
    browser = await chromium.launch()
    ;({ page } = await watch(browser, site.url))
    // A browser that takes its time to say what it kept for the page, as a busy one does: the
    // page asks how much room it has before it asks for its folders.
    await page.addInitScript(() => {
      const estimate = navigator.storage.estimate.bind(navigator.storage)
      navigator.storage.estimate = () =>
        new Promise((resolve) => setTimeout(() => resolve(estimate()), 1500))
    })
    await page.goto(site.url)
    await page.getByTestId('search-folders').waitFor()
  }, 60_000 * PATIENCE)
  afterAll(async () => {
    await browser?.close()
    tmp?.cleanup()
  })

  test(
    'is not taken: the lists open when the page knows what it starts with, and nothing is lost',
    async () => {
      // Until then the lists are closed, and say so. A folder pushed at the page all the same
      // (the upload answers a dialog that was opened before) is not taken.
      const early = page.getByTestId('projects-input')
      expect(await early.isDisabled()).toBe(true)
      expect(await textOf(page.getByTestId('folder-waiting').first())).toBe('one moment…')
      await early.setInputFiles(projects)
      expect(await page.getByTestId('folder-row').count()).toBe(0)

      // Open, they take it.
      await giveFolder(page, 'projects-input', projects)
      await giveFolder(page, 'search-input', samples)
      expect([await names(page, 'projects-folders'), await names(page, 'search-folders')]).toEqual([
        ['projects'],
        ['samples'],
      ])

      // After a reload the browser is slow again. A folder that arrives meanwhile was once put
      // in place of the two of the last visit, which were gone for good: now it is not taken.
      await reload(page)
      await page.getByTestId('search-input').setInputFiles(join(samples, 'Lib1'))
      await page.getByTestId('absent').waitFor()
      const lists = async () => [
        await names(page, 'projects-folders'),
        await names(page, 'search-folders'),
      ]
      expect(await lists()).toEqual([['projects'], ['samples']])
      // (What the browser keeps is what it kept: the next visit starts with the same two.)
      await reload(page)
      await page.getByTestId('absent').waitFor()
      expect(await lists()).toEqual([['projects'], ['samples']])
    },
    60_000 * PATIENCE,
  )
})
