/**
 * The app in a browser on Windows, as far as a test on another system can tell: the browser
 * says that it runs on Windows (its user agent), and the library is made up as a disk of
 * Windows has it, with sets that name their files by paths with a drive. The page then says
 * where Ableton keeps its folders there, shows the steps of Windows, and places the folders by
 * those paths. (No one has tried it in a browser on Windows: see `docs/guide/windows.md`.)
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { CORE_LIBRARY_PACK_ID, REL_PACK, REL_PROJECT } from '@livesaver/core'
import {
  deviceSet,
  livePluginDatabase,
  makeProject,
  tempDir,
  writeFile,
  writeSet,
} from '@livesaver/test-kit'
import { type Browser, type BrowserType, chromium, firefox, type Page } from 'playwright'
import { build } from '../build.js'
import { serve } from '../serve.js'
import {
  barriers,
  eventually,
  giveFolder,
  PATIENCE,
  textOf,
  textsOf,
  type Watched,
  watchIn,
} from './support.js'

let site: { url: string; stop: () => void }
beforeAll(async () => {
  await build()
  site = serve()
}, 120_000 * PATIENCE)
afterAll(() => site?.stop())

/** The browsers there are on Windows, each saying that it runs there. */
const ON_WINDOWS: readonly (readonly [name: string, type: BrowserType, agent: string])[] = [
  [
    'Chromium',
    chromium,
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  ],
  [
    'Firefox',
    firefox,
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
  ],
]

const USER = 'C:/Users/someone'
const LIVE = 'C:/ProgramData/Ableton/Live 12 Suite'
const SERUM = 'device:vst3:instr:56535458-6673-5873-6572-756d00000000'

/**
 * As a disk of Windows has it: the projects in the user's Music folder, Ableton's libraries in
 * Documents, Live's own content in ProgramData, Live's plug-in database in AppData.
 */
function library(root: string) {
  const projects = join(root, 'Projects')
  const song = makeProject(projects, 'Song')
  const sample = (path: string, more: object) =>
    deviceSet(path, 4, 0, more).replaceAll('MxPatchRef', 'SampleRef')
  writeFile(join(song, 'Samples', 'own.wav'), 'RIFF')
  writeSet(
    join(song, 'Song.als'),
    sample(`${USER}/Music/Projects/Song Project/Samples/own.wav`, {
      relType: REL_PROJECT,
      relPath: 'Samples/own.wav',
    }),
  )
  writeSet(
    join(song, 'Core.als'),
    sample(`${LIVE}/Resources/Core Library/Samples/x.wav`, {
      relType: REL_PACK,
      relPath: 'Samples/x.wav',
      packName: 'Core Library',
      packId: CORE_LIBRARY_PACK_ID,
    }),
  )
  writeSet(
    join(song, 'Pack.als'),
    sample(`${USER}/Documents/Ableton/Factory Packs/Pack/Samples/x.wav`, {
      relType: REL_PACK,
      relPath: 'Samples/x.wav',
      packName: 'Pack',
      packId: 'www.ableton.com/1',
    }),
  )
  const resources = join(root, 'Resources')
  writeFile(join(resources, 'Core Library', 'Samples', 'x.wav'), 'RIFF')
  const ableton = join(root, 'Ableton')
  writeFile(join(ableton, 'Factory Packs', 'Pack', 'Samples', 'x.wav'), 'RIFF')
  writeFile(join(ableton, 'User Library', 'Samples', 'y.wav'), 'RIFF')
  const database = join(root, 'Live Database')
  livePluginDatabase(database, [
    {
      path: 'C:\\Program Files\\Common Files\\VST3\\Serum.vst3',
      processor: 1,
      devIdentifier: SERUM,
      name: 'Serum',
    },
  ])
  return { projects, resources, ableton, database }
}

const placesOf = async (page: Page) => {
  const rows = page.getByTestId('search-folders').getByTestId('folder-place')
  return Promise.all((await rows.all()).map((row) => textOf(row)))
}

for (const [name, type, agent] of ON_WINDOWS) {
  describe(`the app in a browser on Windows (${name})`, () => {
    let browser: Browser
    let watched: Watched
    let page: Page
    let tmp: { path: string; cleanup: () => void }
    let given: ReturnType<typeof library>

    beforeAll(async () => {
      tmp = tempDir()
      given = library(tmp.path)
      browser = await type.launch()
      const context = await browser.newContext({
        userAgent: agent,
        viewport: { width: 1280, height: 800 },
        timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      watched = await watchIn(context, site.url)
      page = watched.page
      await page.goto(site.url)
      await page.getByTestId('search-folders').waitFor()
    }, 60_000 * PATIENCE)
    afterAll(async () => {
      await browser?.close()
      tmp?.cleanup()
    })

    test(
      'the page says that Windows is only tested on macOS, and where the folders are there',
      async () => {
        expect(await textOf(page.getByTestId('windows-note'))).toStartWith(
          'Windows: only tested on macOS so far livesaver is made and tested on a Mac.',
        )
        const wanted = await textOf(page.getByTestId('wanted'))
        expect(wanted).toContain(
          'your User Library and Factory Packs: the folder Documents\\Ableton in your user folder;',
        )
        expect(wanted).toContain(
          "Live's own content: add the folder “Resources” of Live, which lies in C:\\ProgramData\\Ableton\\Live 12 Suite.",
        )
        expect(wanted).not.toContain('Applications')
        expect(await barriers(page)).toEqual([])
      },
      60_000 * PATIENCE,
    )

    test(
      'the steps to add Live’s own content are those of Windows',
      async () => {
        await page.getByTestId('show-live-guide').click()
        const dialog = page.getByRole('dialog')
        const guide = dialog.getByTestId('live-guide')
        await guide.waitFor()
        expect(await textOf(dialog)).toContain(
          'The samples of Live’s Core Library lie in a folder of Live’s own, which Windows hides.',
        )
        expect(await textsOf(guide.locator('h3'))).toEqual([
          '1Open Live’s folder',
          '2Drag “Resources” onto “Sample folders”',
          '3Scan again',
        ])
        expect(await textOf(guide)).toContain('C:\\ProgramData\\Ableton\\Live 12 Suite\\Resources')
        expect(await textOf(dialog.getByTestId('guide-untested'))).toContain(
          'livesaver is made and tested on a Mac',
        )
        expect(await dialog.getByTestId('guide-picture').count()).toBe(3)
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
      'the sets say where the folders lie on the drives: nothing has to be typed',
      async () => {
        await giveFolder(page, 'projects-input', given.projects)
        await giveFolder(page, 'search-input', given.resources)
        await giveFolder(page, 'search-input', given.ableton)
        await page.getByTestId('scan-library').click()
        await page.getByTestId('fix-card').waitFor({ timeout: 30_000 * PATIENCE })
        // Every sample is where its set says, by its path with a drive: none is missing. (The
        // two of Ableton's libraries are small, so a fix would take them into the project.)
        expect(await textOf(page.getByTestId('missing-card'))).toContain('Nothing')
        expect(await textOf(page.getByTestId('headline-rest'))).toBe('2 more will be after a fix.')
        await page.getByRole('link', { name: 'Settings', exact: true }).click()
        expect(await placesOf(page)).toEqual([
          `${LIVE}/Resources (found from your sets) Change path`,
          `${USER}/Documents/Ableton (found from your sets) Change path`,
        ])
        // Each is recognised for what it is, also under the name it has on Windows.
        const rows = await textsOf(page.getByTestId('search-folders').getByTestId('folder-row'))
        expect(rows.map((row) => row.slice(0, row.indexOf('C:/')))).toEqual([
          "Resources1 file · Live's own content",
          'Ableton2 files · User Library · Factory Packs',
        ])
      },
      90_000 * PATIENCE,
    )

    test(
      'a path is typed as Windows shows it, and may be any path into Live’s folder',
      async () => {
        const row = page.getByTestId('search-folders').getByTestId('folder-row').first()
        await row.getByRole('button', { name: 'Change path' }).click()
        const input = row.getByRole('textbox')
        expect(await input.getAttribute('placeholder')).toBe(
          'Any path into Live’s folder, e.g. C:\\ProgramData\\Ableton\\Live 12 Suite',
        )
        await input.fill('C:\\ProgramData\\Ableton\\Live 12 Beta\\Resources\\Core Library')
        await row.getByRole('button', { name: 'Done' }).click()
        await page.getByTestId('scan').click()
        await page.getByRole('heading', { level: 1, name: 'Overview' }).waitFor()
        await page.getByRole('link', { name: 'Settings', exact: true }).click()
        const typed =
          'C:/ProgramData/Ableton/Live 12 Beta/Resources (from the path you typed) Change path'
        expect(await eventually(async () => (await placesOf(page))[0], typed)).toBe(typed)
      },
      90_000 * PATIENCE,
    )

    test(
      'what is installed is read from Live’s plug-in database alone, and nothing is “Rosetta only”',
      async () => {
        const list = page.getByTestId('installed-folders')
        expect(await textOf(list)).toContain(
          'with this folder, the scan says which plug-ins of your sets are missing.',
        )
        const wanted = await textOf(list.getByTestId('wanted-installed'))
        expect(wanted).toContain(
          "Live's plug-in database: the folder AppData\\Local\\Ableton\\Live Database in your user folder.",
        )
        expect(wanted).not.toContain('/Library/Audio/Plug-Ins')
        await giveFolder(page, 'installed-input', given.database)
        // With the database there, nothing more is asked for: no plug-in folder on Windows.
        expect(await eventually(() => list.getByTestId('wanted-installed').count(), 0)).toBe(0)
        expect(watched.problems).toEqual([])
        expect(watched.outside).toEqual([])
      },
      60_000 * PATIENCE,
    )
  })
}
