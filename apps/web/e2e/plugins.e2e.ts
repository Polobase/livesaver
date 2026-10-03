/**
 * The plug-in screens in the three browser engines. With livesaver behind the app: what the sets
 * use against what is installed, what breaks if a plug-in is uninstalled, and an upgrade to VST3
 * with its undo, on a copy of the set Live saved with VST2 and VST3 devices. On its own: which
 * plug-ins are used, and why the rest cannot be said there.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type Catalog,
  type CatalogEntry,
  type InstalledPlugin,
  Inventory,
} from '@livesaver/plugins'
import { copyFixtures, readSet, tempDir } from '@livesaver/test-kit'
import { startWeb, type WebServer } from 'livesaver'
import type { Browser, Page } from 'playwright'
import { build, DIST } from '../build.js'
import { serve } from '../serve.js'
import {
  barriers,
  cellsOf,
  closeWith,
  ENGINES,
  giveFolder,
  idle,
  PATIENCE,
  restoreState,
  stateIn,
  textOf,
  textsOf,
  watch,
} from './support.js'

const MASSIVE_VST3 = '5653544e694d616d6173736976650000'
const SERUM_VST3 = '56535458667358736572756d00000000'
const CATALOG: Catalog = new Map<string, CatalogEntry>([
  [MASSIVE_VST3, { devIdentifier: `device:vst3:instr:${MASSIVE_VST3}`, name: 'Massive' }],
  [SERUM_VST3, { devIdentifier: `device:vst3:instr:${SERUM_VST3}`, name: 'Serum' }],
])
const installed = (
  format: InstalledPlugin['format'],
  ident: string,
  name: string,
  native = true,
): InstalledPlugin => ({
  format,
  ident,
  name,
  path: `/Plug-Ins/${name}.${format.toLowerCase()}`,
  native,
  scanned: true,
})
/** Serum as VST2 (Intel only) and as VST3, Massive as VST3; Omnisphere is not installed. */
const INVENTORY = new Inventory([
  installed('VST2', '1483109208', 'Serum', false),
  installed('VST3', SERUM_VST3, 'Serum'),
  installed('VST3', MASSIVE_VST3, 'Massive'),
  installed('VST3', 'f00df00df00df00df00df00df00df00d', 'Never Used'),
])

let alone: { url: string; stop: () => void }

beforeAll(async () => {
  await build()
  alone = serve()
}, 120_000 * PATIENCE)
afterAll(() => {
  alone?.stop()
  restoreState()
})

for (const [name, type] of ENGINES) {
  describe(`plug-ins with livesaver in ${name}`, () => {
    let browser: Browser
    let page: Page
    let server: WebServer
    let tmp: { path: string; cleanup: () => void }
    let projects: string
    let problems: string[]
    let outside: string[]

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
      server = await startWeb({
        assets: DIST,
        config,
        liveRunning: () => false,
        plugins: async () => ({ inventory: INVENTORY, catalog: CATALOG }),
      })
      browser = await type.launch()
      ;({ page, problems, outside } = await watch(browser, server.url))
      await page.goto(server.url)
      await page.getByTestId('scan-library').click()
      await page.getByTestId('plugins-card').waitFor({ timeout: 30_000 * PATIENCE })
    }, 60_000 * PATIENCE)
    afterAll(async () => {
      await browser?.close()
      if (server) await idle(server)
      await server?.close()
      tmp?.cleanup()
    })

    const vstSet = () => join(projects, 'VST2toVST3 Project', 'VST2toVST3.als')
    const vst3Devices = () => readSet(vstSet()).split('<Vst3PluginInfo').length - 1
    const rows = () => page.locator('table tbody tr[data-slot=tr]')
    const tab = async (label: RegExp) => {
      if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape')
      await page.getByRole('tab', { name: label }).click()
    }

    test(
      'the overview says how the plug-ins stand',
      async () => {
        expect(await textOf(page.getByTestId('plugins-card'))).toBe(
          'Plug-ins Your sets use 6 plug-ins. Not installed 3 Rosetta only 1 Can be upgraded to VST3 2 See the plug-ins',
        )
        await page.getByRole('link', { name: 'See the plug-ins' }).click()
        await page.getByRole('heading', { level: 1, name: 'Plug-ins' }).waitFor()
      },
      30_000 * PATIENCE,
    )

    test(
      'every plug-in of the sets with its state, what needs attention first',
      async () => {
        await rows().first().waitFor()
        // Plug-in, format, state, what can be done; then instances, sets, projects.
        expect((await cellsOf(rows())).map((cells) => cells.slice(0, 4))).toEqual([
          ['MassiveNiMa', 'VST2', 'Not installed', 'Can be upgraded to VST3'],
          ['OmnisphereAmbr', 'VST2', 'Not installed', ''],
          ['Omnisphere', 'VST3', 'Not installed', ''],
          ['SerumXfsX', 'VST2', 'Rosetta only', 'Can be upgraded to VST3'],
          ['Massive', 'VST3', 'Installed', ''],
          ['Serum', 'VST3', 'Installed', ''],
        ])
        expect((await cellsOf(rows()))[0]?.slice(4)).toEqual(['1', '1', '1'])
        await page.getByLabel('Filter plug-ins').click()
        await page.getByRole('option', { name: 'Can be upgraded' }).click()
        expect(await page.getByTestId('shown').innerText()).toBe('2 of 6')
        await page.getByLabel('Search plug-ins').fill('serum')
        expect(await page.getByTestId('shown').innerText()).toBe('1 of 6')
      },
      30_000 * PATIENCE,
    )

    test(
      'a plug-in opens from the side with what to do, and leads to the upgrade',
      async () => {
        await rows().first().click()
        const panel = page.getByRole('dialog')
        expect(await panel.getByRole('heading', { level: 2 }).innerText()).toBe('Serum')
        expect(await textsOf(panel.getByTestId('plugin-advice').locator('li'))).toEqual([
          'It contains Intel code only, so Live loads it only when Live itself runs under Rosetta.',
          'Its VST3 is installed, and livesaver can switch the sets to it, keeping the sound: see Upgrade.',
        ])
        expect(await textOf(panel)).toContain('Used 1 time in 1 set')
        expect(await textOf(panel)).toContain('VST2toVST3 Project/VST2toVST3.als')
        expect(await textOf(panel)).toContain('VST3 · Serum runs natively')
        expect(await barriers(page)).toEqual([])
        await panel.getByRole('button', { name: 'Go to Upgrade' }).click()
        await page.getByTestId('upgrade-plugins').waitFor({ timeout: 30_000 * PATIENCE })
      },
      60_000 * PATIENCE,
    )

    test(
      'what is installed, and what breaks if it is uninstalled',
      async () => {
        await tab(/Installed/)
        await rows().first().waitFor()
        // Plug-in, format, how it runs, version, known to Live, used by.
        expect(await cellsOf(rows())).toEqual([
          ['Massive', 'VST3', 'Natively', '', 'Yes', '1 set'],
          ['Never Used', 'VST3', 'Natively', '', 'Yes', 'no set'],
          ['Serum', 'VST2', 'Rosetta only', '', 'Yes', '1 set'],
          ['Serum', 'VST3', 'Natively', '', 'Yes', '1 set'],
        ])
        await page.getByLabel('Filter installed plug-ins').click()
        await page.getByRole('option', { name: 'Used by no set' }).click()
        expect((await cellsOf(rows())).map((cells) => cells[0])).toEqual(['Never Used'])
        await rows().first().click()
        const panel = page.getByRole('dialog')
        expect(await textOf(panel.getByTestId('uninstall'))).toContain(
          'Nothing breaks: no set relies on it.',
        )
        await page.keyboard.press('Escape')
        await page.getByLabel('Filter installed plug-ins').click()
        await page.getByRole('option', { name: 'Rosetta only' }).click()
        await rows().first().click()
        expect(await textOf(panel.getByTestId('uninstall'))).toContain(
          'in 2 formats (VST2, VST3). 1 set in 1 project would open with a placeholder instead of it.',
        )
        await page.keyboard.press('Escape')
      },
      30_000 * PATIENCE,
    )

    test(
      'the upgrade says per plug-in what converts and what stands in the way',
      async () => {
        await tab(/Upgrade to VST3/)
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
        expect(await cellsOf(rows())).toEqual([
          ['VST2toVST3 Project/VST2toVST3.als', 'Omnisphere', '1', 'VST3 not installed'],
          ['VST2toVST3 Project/VST2toVST3.als', 'Serum', '1', 'Converts to VST3'],
          ['VST2toVST3 Project/VST2toVST3.als', 'Massive', '1', 'Converts to VST3'],
        ])
        // Unticking a plug-in takes it out of what is upgraded.
        await page.getByRole('checkbox', { name: 'Massive' }).click()
        expect(await page.getByTestId('upgrade-headline').innerText()).toBe(
          '1 set can be upgraded: 1 instance of 1 plug-in',
        )
      },
      60_000 * PATIENCE,
    )

    test(
      'an upgrade is reviewed, rewrites the set, and its undo brings it back exactly',
      async () => {
        const before = readFileSync(vstSet())
        expect(vst3Devices()).toBe(3)
        await page.getByTestId('review-upgrade').click()
        const dialog = page.getByRole('dialog')
        expect(await textsOf(dialog.getByTestId('upgrade-plan').locator('dl > div'))).toEqual([
          '1set rewritten, in 1 project',
          '1instance switched to VST3',
        ])
        expect(await dialog.getByLabel('Plug-ins that are upgraded').locator('li').count()).toBe(1)
        expect(await barriers(page)).toEqual([])
        await dialog.getByTestId('upgrade-continue').click()
        expect(await textOf(dialog.getByTestId('upgrade-ready'))).toContain(
          'Ableton Live is closed',
        )
        await dialog.getByRole('button', { name: 'Upgrade 1 set' }).click()
        await dialog.getByTestId('upgrade-done').waitFor({ timeout: 30_000 * PATIENCE })
        expect(await textOf(dialog.getByTestId('upgrade-result'))).toContain(
          'Upgraded: 1 set rewritten.',
        )
        await closeWith(dialog, dialog.getByTestId('upgrade-done'))
        expect(vst3Devices()).toBe(4)

        // Scanned and planned again: only Massive is left to upgrade.
        await page.getByTestId('upgrade-headline').getByText('1 instance of 1 plug-in').waitFor({
          timeout: 30_000,
        })
        await page.getByRole('checkbox', { name: 'Massive' }).waitFor()
        expect(await page.getByRole('checkbox', { name: 'Serum' }).count()).toBe(0)

        await page
          .getByTestId('upgraded')
          .getByRole('button', { name: 'Undo this upgrade' })
          .click()
        await page.getByTestId('upgrade-undone').waitFor({ timeout: 30_000 * PATIENCE })
        expect(readFileSync(vstSet()).equals(before)).toBe(true)
        await page.getByRole('checkbox', { name: 'Serum' }).waitFor({ timeout: 30_000 * PATIENCE })
      },
      90_000 * PATIENCE,
    )

    test(
      'after a reload the plan is there, and the last upgrade can still be undone',
      async () => {
        await page.getByTestId('review-upgrade').click()
        const dialog = page.getByRole('dialog')
        await dialog.getByTestId('upgrade-continue').click()
        await dialog.getByRole('button', { name: 'Upgrade 1 set' }).click()
        await dialog.getByTestId('upgrade-done').waitFor({ timeout: 30_000 * PATIENCE })
        await closeWith(dialog, dialog.getByTestId('upgrade-done'))
        expect(vst3Devices()).toBe(5)
        await page.getByTestId('upgrade-headline').getByText('Nothing to upgrade').waitFor({
          timeout: 30_000,
        })

        await page.reload()
        await page.getByTestId('last-upgrade').waitFor({ timeout: 30_000 * PATIENCE })
        expect(await page.getByTestId('upgrade-headline').innerText()).toBe('Nothing to upgrade')
        expect(await textOf(page.getByTestId('last-upgrade'))).toMatch(
          /^The last upgrade, \d\d:\d\d, rewrote 1 set\./,
        )
        await page.getByTestId('last-upgrade').getByRole('button', { name: /Undo/ }).click()
        await page.getByTestId('upgrade-undone').waitFor({ timeout: 30_000 * PATIENCE })
        expect(vst3Devices()).toBe(3)
        await page.getByTestId('upgrade-headline').getByText('2 instances of 2 plug-ins').waitFor({
          timeout: 30_000,
        })
      },
      90_000 * PATIENCE,
    )

    for (const scheme of ['light', 'dark'] as const) {
      test(
        `the plug-in screens have no barrier in ${scheme}`,
        async () => {
          await page.emulateMedia({ colorScheme: scheme })
          for (const label of [/In your sets/, /Installed/, /Upgrade to VST3/]) {
            await tab(label)
            await page.waitForTimeout(200)
            expect([String(label), await barriers(page)]).toEqual([String(label), []])
          }
        },
        60_000 * PATIENCE,
      )
    }

    test('the page reported no errors, and asked nothing outside its own address', () => {
      expect(problems).toEqual([])
      expect(outside).toEqual([])
    })
  })

  describe(`plug-ins on its own in ${name}`, () => {
    let browser: Browser
    let page: Page
    let tmp: { path: string; cleanup: () => void }
    let problems: string[]

    beforeAll(async () => {
      tmp = tempDir()
      const { projects } = copyFixtures(tmp.path)
      browser = await type.launch()
      ;({ page, problems } = await watch(browser, alone.url))
      await page.goto(alone.url)
      await giveFolder(page, 'projects-input', projects)
      await page.getByTestId('scan-library').click()
      await page.getByTestId('plugins-card').waitFor({ timeout: 30_000 * PATIENCE })
    }, 60_000 * PATIENCE)
    afterAll(async () => {
      await browser?.close()
      tmp?.cleanup()
    })

    test(
      'says which plug-ins the sets use, and why it cannot say more',
      async () => {
        expect(await textOf(page.getByTestId('plugins-used'))).toBe(
          'Your sets use 6 plug-ins; whether they are installed is not known here.',
        )
        await page.getByRole('link', { name: 'See the plug-ins' }).click()
        await page.locator('table tbody tr[data-slot=tr]').first().waitFor()
        expect(await page.getByTestId('no-inventory').innerText()).toContain(
          'Whether they are installed, a page in a browser cannot see',
        )
        expect(await page.getByText('Not known').count()).toBe(6)
        await page.getByRole('tab', { name: /Installed/ }).click()
        expect(await page.getByTestId('no-installed').innerText()).toContain(
          'What is installed is not known here',
        )
        await page.getByRole('tab', { name: /Upgrade to VST3/ }).click()
        expect(await page.getByTestId('no-upgrade').innerText()).toContain(
          'Upgrading needs livesaver on your computer',
        )
        expect(await barriers(page)).toEqual([])
        expect(problems).toEqual([])
      },
      60_000 * PATIENCE,
    )
  })
}
