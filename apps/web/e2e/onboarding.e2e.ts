/**
 * The first steps with the app, in the three browser engines. On its own: what the page says
 * about handing it a folder, how the Live app is added, and that the folders stay on the
 * overview after a scan, where one is added and the library scanned again. And the option that
 * leaves the sets of an older Live out, on its own and with livesaver behind the app.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { copyFixtures, readSet, tempDir, writeSet } from '@livesaver/test-kit'
import { startWeb, type WebServer } from 'livesaver'
import { type Browser, chromium, type Page } from 'playwright'
import { build, DIST } from '../build.js'
import { serve } from '../serve.js'
import {
  barriers,
  ENGINES,
  eventually,
  giveFolder,
  idle,
  noPlugins,
  PATIENCE,
  restoreState,
  stateIn,
  textOf,
  textsOf,
  type Watched,
  watch,
} from './support.js'

let site: { url: string; stop: () => void }
beforeAll(async () => {
  await build()
  site = serve()
}, 120_000 * PATIENCE)
afterAll(() => {
  site?.stop()
  restoreState()
})

const OLD = 'Brokenpath (first save).als'

/**
 * The fixtures, and beside the set that misses a sample its first save, as Live 9 had saved it:
 * an old save that is kept as it was.
 */
function library(root: string) {
  const { projects, samples } = copyFixtures(root)
  const now = readSet(join(projects, 'Brokenpath Project', 'Brokenpath.als'))
  writeSet(
    join(projects, 'Brokenpath Project', OLD),
    now.replace(/Creator="Ableton Live [^"]*"/, 'Creator="Ableton Live 9.7.7"'),
  )
  return { projects, samples }
}

const headline = (page: Page) => page.locator('#headline').innerText()
const hash = (page: Page) => new URL(page.url()).hash

for (const [name, type] of ENGINES) {
  describe(`the first steps with the app on its own in ${name}`, () => {
    let browser: Browser
    let watched: Watched
    let page: Page
    let tmp: { path: string; cleanup: () => void }
    let projects: string
    let samples: string
    /** Chromium hands out a handle with a drop: a page can keep such a folder. */
    const keeps = name === 'Chromium'

    beforeAll(async () => {
      tmp = tempDir()
      ;({ projects, samples } = library(tmp.path))
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

    const folders = () => page.getByTestId('library-section')
    const summary = () => textOf(folders().getByTestId('library-summary'))

    test(
      'the page says what handing it a folder means, before one is handed over',
      async () => {
        const box = page.getByTestId('kept-note')
        const said = await textOf(box)
        expect(said).toStartWith('Nothing is uploaded: your files stay on your computer')
        expect(said).toContain(
          'Your browser calls handing a folder to a page an “upload”, and may ask “Upload 1,234 files to this site?”: it means “let this page read them”. livesaver has no server, and nothing is sent anywhere.',
        )
        expect(said).toContain(
          keeps
            ? 'So drop the folders you want kept.'
            : 'The folders themselves have to be added again then.',
        )
        // How it works is one press away: the ways a page comes by a folder, and what the
        // browser's questions mean.
        expect(await box.getByTestId('folder-access').count()).toBe(0)
        await box.getByTestId('how-it-works').click()
        const more = await textOf(box.getByTestId('folder-access'))
        expect(more).toContain(
          'A page cannot look at your disk. It gets a folder only when you hand it one',
        )
        expect(more).toContain(
          '“Upload … files to this site?” Let this page read them. That is all: nothing leaves your computer.',
        )
        // Only where a browser hands out handles is there more to say.
        expect(more.includes('the File System Access API of Chrome, Edge and Brave')).toBe(keeps)
        expect(more.includes('“Can’t open this folder because it contains system files”')).toBe(
          keeps,
        )
        expect(await barriers(page)).toEqual([])
        await box.getByTestId('how-it-works').click()
        expect(await box.getByTestId('folder-access').count()).toBe(0)
      },
      60_000 * PATIENCE,
    )

    test(
      'how the Live app is added is shown step by step, in pictures',
      async () => {
        await page.getByTestId('show-live-guide').click()
        const dialog = page.getByRole('dialog')
        const guide = dialog.getByTestId('live-guide')
        await guide.waitFor()
        expect(await textsOf(guide.locator('h3'))).toEqual([
          '1Open your Applications folder',
          '2Drag the app onto “Sample folders”',
          '3Scan again',
        ])
        expect(await textOf(guide)).toContain(
          'right-click the app, choose Show Package Contents, and drag Contents here.',
        )
        // Each step has its picture; what a picture shows is said in the step.
        expect(await dialog.getByTestId('guide-picture').count()).toBe(4)
        expect(await textOf(dialog.getByTestId('guide-dialog-note'))).toBe(
          'Should your browser say it cannot open the folder Press Cancel. The page has the folder all the same: a browser reads an app’s folder for a page, it only keeps none for your next visit. So the Live app is added again on every visit.',
        )
        expect(await barriers(page)).toEqual([])
        await page.emulateMedia({ colorScheme: 'dark' })
        expect(await barriers(page)).toEqual([])
        await page.emulateMedia({ colorScheme: 'light' })
        await dialog.getByTestId('guide-close').click()
        await dialog.waitFor({ state: 'hidden' })
      },
      60_000 * PATIENCE,
    )

    test(
      'after a scan the folders stay on the overview: one is added and the library scanned again there',
      async () => {
        await giveFolder(page, 'projects-input', projects)
        await page.getByTestId('scan-library').click()
        await page.getByTestId('fix-card').waitFor({ timeout: 30_000 * PATIENCE })
        // (The sample the two saves miss also lies in another project: both can be fixed.)
        expect(await headline(page)).toBe('2 of 4 sets are complete')
        expect(await page.getByTestId('headline-rest').innerText()).toBe(
          '2 more will be after a fix.',
        )
        const searched = async () =>
          Number(/against ([\d,]+) audio files/.exec(await textOf(page.getByTestId('facts')))?.[1])
        const before = await searched()

        // One line says what was read, and opens into the folders.
        expect(await summary()).toBe('1 project folder · 0 sample folders')
        expect(await folders().getByTestId('projects-folders').count()).toBe(0)
        await folders().getByTestId('library-toggle').click()
        expect(await textsOf(folders().getByTestId('folder-name'))).toEqual(['projects'])
        // (What a first visit explains is one press away here, not spelled out again.)
        expect(await textOf(folders().getByTestId('kept-note'))).toBe(
          'Nothing is uploaded: your files stay on your computer How it works, and what your browser may ask',
        )
        await giveFolder(page, 'search-input', samples)
        expect(await summary()).toBe('1 project folder · 1 sample folder · changed since the scan')
        expect(await barriers(page)).toEqual([])

        // Scanned again where the folders are, and where the result is read: the files of the
        // new folder were searched as well.
        await folders().getByTestId('scan-folders').click()
        const settled = '1 project folder · 1 sample folder'
        expect(await eventually(summary, settled)).toBe(settled)
        expect(await searched()).toBeGreaterThan(before)
        expect(hash(page)).toBe('#/')
        // Closed, the line is all that is left of it.
        await folders().getByTestId('library-toggle').click()
        expect(await folders().getByTestId('projects-folders').count()).toBe(0)
      },
      90_000 * PATIENCE,
    )

    test(
      'a scan that is started in the settings is watched on the overview',
      async () => {
        await page.getByRole('link', { name: 'Settings', exact: true }).click()
        await page.getByRole('heading', { level: 1, name: 'Settings' }).waitFor()
        await page.getByTestId('scan').click()
        await page.getByRole('heading', { level: 1, name: 'Overview' }).waitFor()
        expect(hash(page)).toBe('#/')
        await page.getByTestId('fix-card').waitFor({ timeout: 30_000 * PATIENCE })
      },
      60_000 * PATIENCE,
    )

    test(
      'an old save that stands in the way can be left out: the project says so, and the scan how many',
      async () => {
        await page.getByRole('link', { name: 'Samples', exact: true }).click()
        await page.getByRole('cell', { name: 'Brokenpath Project', exact: true }).click()
        const panel = page.getByRole('dialog')
        expect(await textOf(panel.getByTestId('older-saves'))).toBe(
          'One of them is an older save (Live 9) of a project that Live 12 saved since. If you keep it only as it was, a scan can leave such sets out: “Leave out sets of older Live versions”, in the folders and options.',
        )
        // The option is where the folders are: on the overview.
        await panel.getByRole('link', { name: '“Leave out sets of older Live versions”' }).click()
        await page.getByRole('heading', { level: 1, name: 'Overview' }).waitFor()
        const choice = folders().getByTestId('min-live')
        await choice.waitFor()
        expect(await textOf(choice)).toBe('Check every set')
        await choice.click()
        await page.getByRole('option', { name: 'Leave out Live 9 and older' }).click()
        await folders().getByTestId('scan-folders').click()
        const note = page.getByTestId('left-out')
        await note.waitFor({ timeout: 30_000 * PATIENCE })
        expect(await textOf(note)).toBe('1 set saved with Live 9 or older is left out, as you set.')
        expect(await headline(page)).toBe('2 of 3 sets are complete')
        // It is in no list, and the project has nothing more to say about it.
        await page.getByRole('link', { name: 'Samples', exact: true }).click()
        await page.getByRole('tab', { name: /^Sets/ }).click()
        expect(await page.getByRole('cell', { name: OLD }).count()).toBe(0)
        expect(await page.getByRole('cell', { name: 'Brokenpath.als', exact: true }).count()).toBe(
          1,
        )
        await page.getByRole('tab', { name: /^Projects/ }).click()
        await page.getByRole('cell', { name: 'Brokenpath Project', exact: true }).click()
        await panel.getByText('1 set', { exact: true }).waitFor()
        expect(await panel.getByTestId('older-saves').count()).toBe(0)
        await page.keyboard.press('Escape')
        await panel.waitFor({ state: 'hidden' })
        expect(watched.problems).toEqual([])
        expect(watched.outside).toEqual([])
      },
      90_000 * PATIENCE,
    )
  })
}

describe('with livesaver behind the app, the same sets are left out (Chromium)', () => {
  let browser: Browser
  let page: Page
  let server: WebServer
  let tmp: { path: string; cleanup: () => void }

  beforeAll(async () => {
    tmp = tempDir()
    const { projects, samples } = library(tmp.path)
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
    'the option of the scan is livesaver’s --min-live: the old save is checked, then left out',
    async () => {
      await page.getByTestId('scan-library').click()
      await page.getByTestId('fix-card').waitFor({ timeout: 30_000 * PATIENCE })
      expect(await headline(page)).toBe('2 of 4 sets are complete')
      expect(await page.getByTestId('left-out').count()).toBe(0)
      // On this computer the folders are known by their paths, and nothing is "uploaded".
      const folders = page.getByTestId('library-section')
      await folders.getByTestId('library-toggle').click()
      expect(await folders.getByTestId('kept-note').count()).toBe(0)
      await folders.getByTestId('min-live').click()
      await page.getByRole('option', { name: 'Leave out Live 9 and older' }).click()
      await folders.getByTestId('scan-folders').click()
      const note = page.getByTestId('left-out')
      await note.waitFor({ timeout: 30_000 * PATIENCE })
      expect(await textOf(note)).toBe('1 set saved with Live 9 or older is left out, as you set.')
      expect(await headline(page)).toBe('2 of 3 sets are complete')
      expect(await textOf(page.getByTestId('fix-card'))).toContain('1 set in 1 project')
    },
    90_000 * PATIENCE,
  )
})
