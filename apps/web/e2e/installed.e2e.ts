/**
 * What is installed, shown to a page that has no livesaver behind it: a plug-in folder and the
 * folder of Live's plug-in database, handed over like any folder, in the three browser engines.
 * And in Chromium, with fixing in the page switched on, an upgrade of VST2 plug-ins to VST3 that
 * the page makes itself: compared with what livesaver writes on the same project on disk. (The
 * project folder the page edits lies in the browser's own file system: see `handed.ts`.)
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { copyFixtures, readSet, tempDir, uploadedFolder } from '@livesaver/test-kit'
import { installedIn } from '@livesaver/web'
import { startWeb } from 'livesaver'
import { type Browser, chromium, type Page } from 'playwright'
import { build } from '../build.js'
import { serve } from '../serve.js'
import { ComputerEngine, folderAt } from '../src/engine/index.js'
import { installPlugins } from '../test/engine-setup.js'
import { fill, handOut, sha1, written, xml } from './handed.js'
import {
  barriers,
  cellsOf,
  closeWith,
  ENGINES,
  giveFolder,
  PATIENCE,
  restoreState,
  stateIn,
  textOf,
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

const VST_SET = 'VST2toVST3 Project/VST2toVST3.als'

for (const [name, type] of ENGINES) {
  describe(`what is installed, shown to a page in ${name}`, () => {
    let browser: Browser
    let watched: Watched
    let page: Page
    let tmp: { path: string; cleanup: () => void }
    /** A plug-in folder and the folder of Live's database, as a Mac has them. */
    let mac: { plugins: string; database: string }

    beforeAll(async () => {
      tmp = tempDir()
      const { projects } = copyFixtures(tmp.path)
      mac = installPlugins(tmp.path)
      browser = await type.launch()
      watched = await watch(browser, site.url)
      page = watched.page
      await page.goto(site.url)
      await giveFolder(page, 'projects-input', projects)
      await page.getByTestId('scan-library').click()
      await page.getByTestId('plugins-card').waitFor({ timeout: 30_000 * PATIENCE })
    }, 60_000 * PATIENCE)
    afterAll(async () => {
      await browser?.close()
      tmp?.cleanup()
    })

    const goTo = async (place: string) => {
      await page.getByRole('link', { name: place, exact: true }).click()
      await page.getByRole('heading', { level: 1, name: place, exact: true }).waitFor()
    }
    const rows = () => page.locator('table tbody tr[data-slot=tr]')
    const list = () => page.getByTestId('installed-folders')
    /**
     * Scans again from wherever the page is, and goes to the plug-ins. The scan may still run
     * then: a test waits for what it is to show.
     */
    const scanAgain = async () => {
      await page.getByTestId('scan').click()
      await goTo('Plug-ins')
    }
    /** Plug-in, format and state of every plug-in the sets use. */
    const states = async () => (await cellsOf(rows())).map((cells) => cells.slice(0, 3))

    test(
      'a page cannot see what is installed, and says how to show it',
      async () => {
        await goTo('Plug-ins')
        const note = page.getByTestId('no-inventory')
        expect(await textOf(note)).toContain(
          "Whether they are installed, a page in a browser cannot see by itself: add your plug-in folder and Live's database folder in the Settings",
        )
        await note.getByRole('link', { name: 'Settings' }).click()
        await page.getByRole('heading', { level: 1, name: 'Settings' }).waitFor()
        expect(await textOf(list())).toContain('Installed plug-ins Optional.')
        const wanted = await textOf(list().getByTestId('wanted-installed'))
        expect(wanted).toContain('your plug-ins: the folder /Library/Audio/Plug-Ins')
        expect(wanted).toContain(
          "Live's plug-in database: the folder Library/Application Support/Ableton/Live Database in your home folder.",
        )
        expect(await barriers(page)).toEqual([])
      },
      60_000 * PATIENCE,
    )

    test(
      'the plug-in folder alone: what a bundle says of itself is known, a VST2 plug-in is not',
      async () => {
        await giveFolder(page, 'installed-input', mac.plugins)
        const row = list().getByTestId('folder-row')
        expect(await row.count()).toBe(1)
        expect(await textOf(row.getByTestId('folder-facts'))).toContain('Plug-ins')
        // Where such a folder lies the page works out by itself: there is nothing to type.
        expect(await row.getByTestId('folder-place').count()).toBe(0)
        const wanted = await textOf(list().getByTestId('wanted-installed'))
        expect(wanted).not.toContain('your plug-ins')
        expect(wanted).toContain("Live's plug-in database")

        await scanAgain()
        const partial = page.getByTestId('partial-inventory')
        await partial.waitFor({ timeout: 30_000 * PATIENCE })
        expect(await textOf(partial)).toContain(
          "Live's plug-in database was not among the folders that say what is installed. Without it a plug-in is known only if its bundle says which one it is",
        )
        // The VST3 of Massive carries its ids; that of Serum is known to Live's database only.
        expect(await states()).toEqual([
          ['MassiveNiMa', 'VST2', 'Not installed'],
          ['OmnisphereAmbr', 'VST2', 'Not installed'],
          ['Omnisphere', 'VST3', 'Not installed'],
          ['SerumXfsX', 'VST2', 'Not installed'],
          ['Serum', 'VST3', 'Not installed'],
          ['Massive', 'VST3', 'Installed'],
        ])
      },
      90_000 * PATIENCE,
    )

    test(
      'with Live’s database, the page says what livesaver on the computer says',
      async () => {
        await goTo('Settings')
        await giveFolder(page, 'installed-input', mac.database)
        expect(await list().getByTestId('folder-row').count()).toBe(2)
        expect(await list().getByTestId('wanted-installed').count()).toBe(0)

        await scanAgain()
        await page
          .getByTestId('partial-inventory')
          .waitFor({ state: 'detached', timeout: 30_000 * PATIENCE })
        expect(await page.getByTestId('no-inventory').count()).toBe(0)
        // As with livesaver behind the app (`plugins.e2e.ts`): the VST2 of Serum is Intel only.
        expect((await cellsOf(rows())).map((cells) => cells.slice(0, 4))).toEqual([
          ['MassiveNiMa', 'VST2', 'Not installed', 'Can be upgraded to VST3'],
          ['OmnisphereAmbr', 'VST2', 'Not installed', ''],
          ['Omnisphere', 'VST3', 'Not installed', ''],
          ['SerumXfsX', 'VST2', 'Rosetta only', 'Can be upgraded to VST3'],
          ['Massive', 'VST3', 'Installed', ''],
          ['Serum', 'VST3', 'Installed', ''],
        ])
        await page.getByRole('tab', { name: /Installed/ }).click()
        await rows().first().waitFor()
        // Plug-in, format, how it runs, version, known to Live, used by.
        expect(await cellsOf(rows())).toEqual([
          ['Massive', 'VST3', 'Natively', '', 'Yes', '1 set'],
          ['Serum', 'VST2', 'Rosetta only', '', 'Yes', '1 set'],
          ['Serum', 'VST3', 'Natively', '', 'Yes', '1 set'],
        ])
        await goTo('Overview')
        expect(await textOf(page.getByTestId('plugins-card'))).toBe(
          'Plug-ins Your sets use 6 plug-ins. Not installed 3 Rosetta only 1 Can be upgraded to VST3 2 See the plug-ins',
        )
      },
      90_000 * PATIENCE,
    )

    for (const scheme of ['light', 'dark'] as const) {
      test(
        `the screens have no barrier in ${scheme}`,
        async () => {
          await page.emulateMedia({ colorScheme: scheme })
          await goTo('Settings')
          expect(['Settings', await barriers(page)]).toEqual(['Settings', []])
          await goTo('Plug-ins')
          for (const label of [/In your sets/, /Installed/, /Upgrade to VST3/]) {
            await page.getByRole('tab', { name: label }).click()
            await page.waitForTimeout(200)
            expect([String(label), await barriers(page)]).toEqual([String(label), []])
          }
        },
        60_000 * PATIENCE,
      )
    }

    test('the page reported no errors, and asked nothing outside its own address', () => {
      expect(watched.problems).toEqual([])
      expect(watched.outside).toEqual([])
    })
  })
}

describe('an upgrade to VST3 that the page makes itself (Chromium)', () => {
  let browser: Browser
  let watched: Watched
  let page: Page
  let tmp: { path: string; cleanup: () => void }
  let projects: string
  let mac: { plugins: string; database: string }

  beforeAll(async () => {
    tmp = tempDir()
    ;({ projects } = copyFixtures(tmp.path))
    mac = installPlugins(tmp.path)
    browser = await chromium.launch()
    watched = await watch(browser, site.url)
    page = watched.page
    await handOut(page)
    // Fixing in the page was switched on before (its switch and its dialog: `writing.e2e.ts`).
    await page.addInitScript(() => localStorage.setItem('livesaver:fix-in-browser', 'on'))
    await page.goto(site.url)
    await fill(page, projects)
    await page.getByTestId('projects-folders').getByRole('button', { name: 'Add folder' }).click()
    await page.getByTestId('projects-folders').getByTestId('folder-row').first().waitFor()
    await page.getByTestId('scan-library').click()
    await page.getByTestId('plugins-card').waitFor({ timeout: 30_000 * PATIENCE })
  }, 60_000 * PATIENCE)
  afterAll(async () => {
    await browser?.close()
    tmp?.cleanup()
  })

  const goTo = async (place: string) => {
    await page.getByRole('link', { name: place, exact: true }).click()
    await page.getByRole('heading', { level: 1, name: place, exact: true }).waitFor()
  }
  const upgradeTab = async () => {
    await goTo('Plug-ins')
    await page.getByRole('tab', { name: /Upgrade to VST3/ }).click()
  }

  test(
    'without Live’s database the page says what it has to be shown first',
    async () => {
      await upgradeTab()
      const note = page.getByTestId('no-plan')
      await note.waitFor({ timeout: 30_000 * PATIENCE })
      expect(await textOf(note)).toContain(
        'Nothing can be upgraded here To know which VST3 plug-ins Live has, this page needs Live’s plug-in database: add the folder “Live Database” to the plug-in folders, and scan again.',
      )
      // The way to the folder is one press away.
      expect(
        await note
          .getByRole('link', { name: 'Add the folder in the Settings' })
          .getAttribute('href'),
      ).toBe('#/settings')
      expect(await page.getByTestId('review-upgrade').count()).toBe(0)
      expect(await barriers(page)).toEqual([])
    },
    60_000 * PATIENCE,
  )

  test(
    'with the folders that say what is installed, it plans what livesaver plans',
    async () => {
      await goTo('Settings')
      await giveFolder(page, 'installed-input', mac.plugins)
      await giveFolder(page, 'installed-input', mac.database)
      // Scanned again, the page plans by itself: nobody has to ask it to try once more.
      await page.getByTestId('scan').click()
      await upgradeTab()
      await page.getByTestId('upgrade-plugins').waitFor({ timeout: 30_000 * PATIENCE })
      expect(await page.getByTestId('upgrade-headline').innerText()).toBe(
        '1 set can be upgraded: 2 instances of 2 plug-ins',
      )
      const cards = page.getByTestId('upgrade-plugins').locator(':scope > li')
      expect(await Promise.all([0, 1, 2].map((i) => textOf(cards.nth(i))))).toEqual([
        'Massive 1 of 1 Converts in 1 of 1 set.',
        'Omnisphere 0 of 1 Converts in none of its 1 set. 1 instance: VST3 not installed',
        'Serum 1 of 1 Converts in 1 of 1 set.',
      ])
    },
    90_000 * PATIENCE,
  )

  test(
    'the upgrade writes what livesaver writes, is in the history, and its undo puts the set back',
    async () => {
      const original = readFileSync(join(projects, VST_SET))
      await page.getByTestId('review-upgrade').click()
      const dialog = page.getByRole('dialog')
      await dialog.getByTestId('upgrade-continue').click()
      const ready = dialog.getByTestId('upgrade-ready')
      expect(await textOf(ready.getByTestId('ready-editable'))).toContain(
        'This page may edit your project folders',
      )
      // An upgrade writes no path into a set: where the folders lie does not matter to it.
      expect(await ready.getByTestId('ready-placed').count()).toBe(0)
      const apply = dialog.getByTestId('upgrade-apply')
      expect(await apply.isDisabled()).toBe(true)
      expect(await barriers(page)).toEqual([])
      await dialog.getByRole('checkbox', { name: 'Ableton Live is closed' }).check()
      await apply.click()
      await dialog.getByTestId('upgrade-done').waitFor({ timeout: 30_000 * PATIENCE })
      expect(await textOf(dialog.getByTestId('upgrade-result'))).toContain(
        'Upgraded: 1 set rewritten.',
      )
      await closeWith(dialog, dialog.getByTestId('upgrade-done'))

      // livesaver on the same project on disk, told of the same plug-ins.
      stateIn(tmp.path)
      const config = join(tmp.path, 'config.json')
      writeFileSync(config, JSON.stringify({ appResources: '', vendorLibraries: [] }))
      const told = await installedIn(
        [mac.plugins, mac.database].map((folder, i) => ({
          id: String(i),
          source: uploadedFolder(folder),
          path: '',
          vendor: false,
        })),
      )
      const server = await startWeb({
        assets: false,
        config,
        liveRunning: () => false,
        plugins: async () => told,
      })
      try {
        const livesaver = new ComputerEngine({ token: server.token, base: server.url })
        const theirs = await livesaver.upgrade({ projects: [folderAt(projects)] })
        expect([theirs.sets, theirs.errors]).toEqual([1, []])
      } finally {
        await server.close()
      }
      const mine = await written(page)
      expect(xml(mine.get(VST_SET)?.data)).toBe(readSet(join(projects, VST_SET)))
      expect(xml(mine.get(VST_SET)?.data).split('<Vst3PluginInfo').length - 1).toBe(5)
      const backup = [...mine].find(([path]) => path.startsWith('VST2toVST3 Project/Backup/V'))
      expect(backup?.[1].sha1).toBe(sha1(original))

      await goTo('History')
      expect(await textOf(page.getByTestId('run').first())).toContain(
        'Upgraded plug-ins to VST3 in 1 set',
      )
      await page.getByRole('button', { name: 'Undo: Upgraded plug-ins to VST3 in 1 set' }).click()
      const confirm = page.getByRole('dialog')
      await closeWith(confirm, confirm.getByTestId('undo-confirm'))
      await page.getByTestId('history-undone').waitFor({ timeout: 30_000 * PATIENCE })
      expect((await written(page)).get(VST_SET)?.sha1).toBe(sha1(original))
    },
    120_000 * PATIENCE,
  )

  test('the page reported no errors, and asked nothing outside its own address', () => {
    expect(watched.problems).toEqual([])
    expect(watched.outside).toEqual([])
  })
})
