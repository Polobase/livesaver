/**
 * Where Ableton's own folders lie, in a page that is not told: the Live app's folder and the
 * folder with the User Library and the Factory Packs are placed by what the sets store, in the
 * three browser engines. And in Chromium, with fixing in the page switched on, the review takes
 * those places as known and shows them, instead of asking for paths to be typed.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { CORE_LIBRARY_PACK_ID, REL_PACK } from '@livesaver/core'
import {
  copyFixtures,
  deviceSet,
  makeProject,
  tempDir,
  writeFile,
  writeSet,
} from '@livesaver/test-kit'
import { type Browser, chromium, type Page } from 'playwright'
import { build } from '../build.js'
import { serve } from '../serve.js'
import { fill, handOut } from './handed.js'
import {
  barriers,
  ENGINES,
  eventually,
  giveFolder,
  PATIENCE,
  textOf,
  textsOf,
  watch,
} from './support.js'

let site: { url: string; stop: () => void }
beforeAll(async () => {
  await build()
  site = serve()
}, 120_000 * PATIENCE)
afterAll(() => site?.stop())

const APP = '/Applications/Ableton Live 12 Suite.app'
const MUSIC = '/Users/someone/Music/Ableton'

/**
 * A library whose sets name a sample of the Core Library and one of a pack, and the folders
 * those lie in as a Mac has them: the Live app's `Contents`, and `Music/Ableton`.
 */
function library(root: string) {
  const { projects, samples } = copyFixtures(root)
  const sample = (path: string, pack: string, id: string) =>
    deviceSet(path, 4, 0, {
      relType: REL_PACK,
      relPath: 'Samples/x.wav',
      packName: pack,
      packId: id,
    }).replaceAll('MxPatchRef', 'SampleRef')
  const song = makeProject(projects, 'Song')
  writeSet(
    join(song, 'Core.als'),
    sample(
      `${APP}/Contents/App-Resources/Core Library/Samples/x.wav`,
      'Core Library',
      CORE_LIBRARY_PACK_ID,
    ),
  )
  writeSet(
    join(song, 'Pack.als'),
    sample(`${MUSIC}/Factory Packs/Pack/Samples/x.wav`, 'Pack', 'www.ableton.com/1'),
  )
  const contents = join(root, 'Ableton Live 12 Suite.app', 'Contents')
  writeFile(join(contents, 'App-Resources', 'Core Library', 'Samples', 'x.wav'), 'RIFF')
  const ableton = join(root, 'Ableton')
  writeFile(join(ableton, 'Factory Packs', 'Pack', 'Samples', 'x.wav'), 'RIFF')
  writeFile(join(ableton, 'User Library', 'Samples', 'y.wav'), 'RIFF')
  return { projects, samples, contents, ableton }
}

/** What each row of the sample folders says about where its folder lies. */
const placesOf = async (page: Page) => {
  const rows = page.getByTestId('search-folders').getByTestId('folder-place')
  return Promise.all((await rows.all()).map((row) => textOf(row)))
}

for (const [name, type] of ENGINES) {
  describe(`where Ableton's own folders lie, in ${name}`, () => {
    let browser: Browser
    let page: Page
    let problems: string[]
    let outside: string[]
    let tmp: { path: string; cleanup: () => void }

    beforeAll(async () => {
      tmp = tempDir()
      const given = library(tmp.path)
      browser = await type.launch()
      ;({ page, problems, outside } = await watch(browser, site.url))
      await page.goto(site.url)
      await giveFolder(page, 'projects-input', given.projects)
      await giveFolder(page, 'search-input', given.contents)
      await giveFolder(page, 'search-input', given.ableton)
      await page.getByTestId('scan-library').click()
      await page.getByTestId('fix-card').waitFor({ timeout: 30_000 * PATIENCE })
      await page.getByRole('link', { name: 'Settings', exact: true }).click()
    }, 60_000 * PATIENCE)
    afterAll(async () => {
      await browser?.close()
      tmp?.cleanup()
    })

    test(
      'the sets say where the Live app and Ableton’s libraries lie: nothing has to be typed',
      async () => {
        expect(await placesOf(page)).toEqual([
          `${APP}/Contents (found from your sets) Change path`,
          `${MUSIC} (found from your sets) Change path`,
        ])
        // The samples the sets name there are where the sets say: nothing of it is missing.
        await page.getByRole('link', { name: 'Overview', exact: true }).click()
        expect(await textOf(page.getByTestId('missing-card'))).toContain('Nothing')
        await page.getByRole('link', { name: 'Settings', exact: true }).click()
        expect(await barriers(page)).toEqual([])
      },
      60_000 * PATIENCE,
    )

    test(
      'a path that is typed for the Live app’s folder may be any path into the app',
      async () => {
        const row = page.getByTestId('search-folders').getByTestId('folder-row').first()
        await row.getByRole('button', { name: 'Change path' }).click()
        const input = row.getByRole('textbox')
        expect(await input.getAttribute('placeholder')).toBe(
          'Any path into the Live app, e.g. /Applications/Ableton Live 12 Suite.app',
        )
        // The path of the app's Core Library, for the folder that is its `Contents`.
        const other = '/Applications/Ableton Live 12 Beta.app'
        await input.fill(`${other}/Contents/App-Resources/Core Library`)
        await row.getByRole('button', { name: 'Done' }).click()
        await page.getByTestId('scan').click()
        // (A scan that is started in the settings is watched on the overview.)
        await page.getByRole('heading', { level: 1, name: 'Overview' }).waitFor()
        await page.getByRole('link', { name: 'Settings', exact: true }).click()
        // Scanned, the row says which path it took the folder to have.
        expect(
          await eventually(
            async () => (await placesOf(page))[0],
            `${other}/Contents (from the path you typed) Change path`,
          ),
        ).toBe(`${other}/Contents (from the path you typed) Change path`)
        expect(problems).toEqual([])
        expect(outside).toEqual([])
      },
      60_000 * PATIENCE,
    )
  })
}

describe('a fix in the page takes those places as known (Chromium)', () => {
  let browser: Browser
  let page: Page
  let tmp: { path: string; cleanup: () => void }

  beforeAll(async () => {
    tmp = tempDir()
    const given = library(tmp.path)
    browser = await chromium.launch()
    ;({ page } = await watch(browser, site.url))
    await handOut(page)
    await page.addInitScript(() => localStorage.setItem('livesaver:fix-in-browser', 'on'))
    await page.goto(site.url)
    await fill(page, given.projects)
    await page.getByTestId('projects-folders').getByRole('button', { name: 'Add folder' }).click()
    await page.getByTestId('projects-folders').getByTestId('folder-row').first().waitFor()
    await giveFolder(page, 'search-input', given.samples)
    await giveFolder(page, 'search-input', given.contents)
    await giveFolder(page, 'search-input', given.ableton)
    await page.getByTestId('scan-library').click()
    await page.getByTestId('fixable').waitFor({ timeout: 30_000 * PATIENCE })
  }, 60_000 * PATIENCE)
  afterAll(async () => {
    await browser?.close()
    tmp?.cleanup()
  })

  test(
    'the review shows where the folders lie that a fix names in the sets, and is ready',
    async () => {
      await page.getByTestId('review').click()
      const dialog = page.getByRole('dialog')
      await dialog.getByTestId('review-continue').click()
      const placed = dialog.getByTestId('ready-placed')
      expect(await textOf(placed)).toContain('It is known where your folders lie on your disk')
      expect(await textsOf(placed.getByTestId('places').locator('li'))).toEqual([
        'projects lies at /Users/someone/livesaver/fixtures/projects (as your sets say)',
        `Contents lies at ${APP}/Contents (as your sets say)`,
        `Ableton lies at ${MUSIC} (as your sets say)`,
      ])
      expect(await barriers(page)).toEqual([])
      // Nothing is left to settle but what a page cannot see: that Live is closed.
      const apply = dialog.getByTestId('review-apply')
      expect(await apply.isDisabled()).toBe(true)
      await dialog.getByRole('checkbox', { name: 'Ableton Live is closed' }).check()
      expect(await apply.isDisabled()).toBe(false)
    },
    60_000 * PATIENCE,
  )
})
