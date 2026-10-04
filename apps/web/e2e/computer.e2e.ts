/**
 * The app with livesaver on this computer behind it, in the three browser engines: folders are
 * chosen by path, the scan runs on the computer, and a fix (of one project, of a selection, of
 * all) and its undo really write: to copies of the fixtures in a temporary folder.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cpSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { copyFixtures, readSet, tempDir } from '@livesaver/test-kit'
import { startWeb, type WebServer } from 'livesaver'
import type { Browser, Page } from 'playwright'
import { build, DIST } from '../build.js'
import {
  barriers,
  closeWith,
  ENGINES,
  eventually,
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

for (const [name, type] of ENGINES) {
  describe(`the app with livesaver in ${name}`, () => {
    let browser: Browser
    let page: Page
    let server: WebServer
    let tmp: { path: string; cleanup: () => void }
    let projects: string
    let samples: string
    let problems: string[]
    let outside: string[]
    let live = false

    beforeAll(async () => {
      tmp = tempDir()
      ;({ projects, samples } = copyFixtures(tmp.path))
      // Two more projects with the same broken set: one is fixed alone, two as a selection.
      for (const copy of ['Other Project', 'Third Project'])
        cpSync(join(projects, 'Brokenpath Project'), join(projects, copy), { recursive: true })
      stateIn(tmp.path)
      const config = join(tmp.path, 'config.json')
      writeFileSync(
        config,
        JSON.stringify({ appResources: '', vendorLibraries: [], searchRoots: [samples] }),
      )
      server = await startWeb({
        assets: DIST,
        config,
        // No set of the copies is open in any Live; a test says when "Live runs".
        liveRunning: () => live,
        plugins: noPlugins,
      })
      browser = await type.launch()
      ;({ page, problems, outside } = await watch(browser, server.url))
      await page.goto(server.url)
      await page.getByTestId('search-folders').waitFor()
    }, 60_000 * PATIENCE)
    afterAll(async () => {
      await browser?.close()
      if (server) await idle(server)
      await server?.close()
      tmp?.cleanup()
    })

    const setOf = (project: string) => join(projects, project, 'Brokenpath.als')
    /** When the set that is fixed first was last saved, before the fix. */
    let dated = 0
    const fixedOnDisk = (project: string) => readSet(setOf(project)).includes('Samples/Imported')
    const onDisk = () =>
      ['Brokenpath Project', 'Other Project', 'Third Project'].map((project) =>
        fixedOnDisk(project),
      )
    const goTo = async (place: string) => {
      if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape')
      await page.getByRole('link', { name: place, exact: true }).click()
      await page.getByRole('heading', { level: 1, name: place, exact: true }).waitFor()
    }
    const rows = () => page.locator('table tbody tr[data-slot=tr]')
    /** The projects that have a button to fix them alone. */
    const fixButtons = () =>
      page
        .locator('table tbody button[aria-label^="Fix "]')
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')))
    /** The overview after the scan that follows a fix or an undo. */
    const rescanned = async (fixable: string) => {
      await page.getByTestId('progress').waitFor({ state: 'hidden', timeout: 30_000 * PATIENCE })
      await page
        .getByTestId('fix-card')
        .getByText(fixable)
        .waitFor({ timeout: 30_000 * PATIENCE })
    }

    test(
      'it starts with the sample folders of this computer, and wants a project folder',
      async () => {
        await page.getByTestId('folder-row').first().waitFor()
        expect(await page.getByTestId('folder-name').allInnerTexts()).toEqual(['samples'])
        expect(await textOf(page.getByTestId('folder-path'))).toBe(samples)
        expect(await page.getByTestId('scan-library').isDisabled()).toBe(true)
        expect(await page.getByTestId('where').innerText()).toBe('On this computer')
      },
      30_000 * PATIENCE,
    )

    test(
      'a project folder is chosen in the page, by clicking through folders or by its path',
      async () => {
        // The folder the browser starts in takes long to list (a large folder, a drive that
        // wakes up): its listing arrives after the path that is typed meanwhile was opened.
        let first = true
        await page.route(`${server.url}api/folders?*`, async (route) => {
          const slow = first
          first = false
          if (slow) await new Promise((resolve) => setTimeout(resolve, 1500))
          await route.continue()
        })
        await page
          .getByTestId('projects-folders')
          .getByRole('button', { name: 'Add folder' })
          .click()
        const dialog = page.getByRole('dialog')
        const path = dialog.getByLabel('Path of the folder')
        await path.fill(tmp.path)
        await path.press('Enter')
        await dialog.getByRole('button', { name: 'projects', exact: true }).waitFor()
        // The late listing changes neither what is listed nor the path that was typed.
        await page.waitForTimeout(2000)
        await page.unroute(`${server.url}api/folders?*`)
        expect(await path.inputValue()).toBe(tmp.path)
        await dialog.getByRole('button', { name: 'projects', exact: true }).click()
        await dialog.getByRole('button', { name: 'Brokenpath Project' }).waitFor()
        expect(await path.inputValue()).toBe(projects)
        expect(await dialog.getByTestId('browser-item').allInnerTexts()).toEqual([
          'Brokenpath Project',
          'Fixed Path Project',
          'Other Project',
          'Third Project',
          'VST2toVST3 Project',
        ])
        await dialog.getByRole('button', { name: 'Up' }).waitFor()
        await path.fill(join(tmp.path, 'nothing'))
        await path.press('Enter')
        expect(await dialog.getByRole('alert').innerText()).toContain('cannot be opened')
        await path.fill(projects)
        await path.press('Enter')
        await dialog.getByRole('button', { name: 'Brokenpath Project' }).waitFor()
        await dialog.getByRole('button', { name: 'Add this folder' }).click()
        await dialog.waitFor({ state: 'hidden' })
        expect(await page.getByTestId('folder-name').allInnerTexts()).toEqual([
          'projects',
          'samples',
        ])
      },
      30_000 * PATIENCE,
    )

    test(
      'the scan runs on this computer and lists the projects, each with its fix',
      async () => {
        // The button is at the end of a page that has to be scrolled; the result is shown from its top.
        await page.getByTestId('scan-library').scrollIntoViewIfNeeded()
        const scrolled = () =>
          page.evaluate(
            () => document.querySelector('main section[aria-label=Overview]')?.scrollTop,
          )
        expect(await scrolled()).toBeGreaterThan(0)
        await page.getByTestId('scan-library').click()
        await rescanned('3 sets in 3 projects')
        expect(await scrolled()).toBe(0)
        expect(await page.locator('#headline').innerText()).toBe('2 of 5 sets are complete')
        expect(await page.getByTestId('facts').innerText()).toContain('on this computer')
        await goTo('Samples')
        await rows().first().waitFor()
        expect(
          (await textsOf(rows())).map((row) =>
            /^(.+ Project)(Can be fixed|Complete)/.exec(row)?.slice(1),
          ),
        ).toEqual([
          ['Brokenpath Project', 'Can be fixed'],
          ['Fixed Path Project', 'Complete'],
          ['Other Project', 'Can be fixed'],
          ['Third Project', 'Can be fixed'],
          ['VST2toVST3 Project', 'Complete'],
        ])
        expect(await fixButtons()).toEqual([
          'Fix Brokenpath Project',
          'Fix Other Project',
          'Fix Third Project',
        ])
      },
      60_000 * PATIENCE,
    )

    test(
      'a fix is reviewed first, and Cancel leaves everything as it is',
      async () => {
        await page.getByRole('button', { name: 'Fix Other Project' }).click()
        const dialog = page.getByRole('dialog')
        expect(await dialog.getByRole('heading', { level: 2 }).innerText()).toBe(
          'Fix "Other Project"',
        )
        expect(await textsOf(dialog.getByTestId('review-plan').locator('dl > div'))).toEqual([
          '1set rewritten',
          '1reference repointed',
          '1file copied · 2.0 MB',
        ])
        expect(await textOf(dialog)).toContain(
          'Every set as it was is kept in the Backup folder of its project.',
        )
        await dialog.getByTestId('review-continue').click()
        const ready = dialog.getByTestId('review-ready')
        expect(await textOf(ready)).toContain('Ableton Live is closed')
        expect(await textOf(ready)).toMatch(/The copies need 2\.0 MB; [\d.]+ [GMT]B are free/)
        expect(await barriers(page)).toEqual([])
        await dialog.getByRole('button', { name: 'Cancel' }).click()
        await dialog.waitFor({ state: 'hidden' })
        expect(onDisk()).toEqual([false, false, false])
      },
      30_000 * PATIENCE,
    )

    test(
      'while Live runs, the review does not let a fix start',
      async () => {
        live = true
        await page.getByRole('button', { name: 'Fix Other Project' }).click()
        const dialog = page.getByRole('dialog')
        await dialog.getByTestId('review-continue').click()
        const ready = dialog.getByTestId('review-ready')
        await ready.getByText('Ableton Live is running').waitFor()
        expect(await textOf(ready)).toContain(
          'Quit it first, so that no open set gets overwritten.',
        )
        expect(await dialog.getByRole('button', { name: 'Fix 1 set' }).isDisabled()).toBe(true)
        expect(await barriers(page)).toEqual([])
        // Live was quit: the page is told to look again, and the fix can start.
        live = false
        await ready.getByRole('button', { name: 'Check again' }).click()
        await ready.getByText('Ableton Live is closed').waitFor()
        expect(await dialog.getByRole('button', { name: 'Fix 1 set' }).isEnabled()).toBe(true)
        await dialog.getByRole('button', { name: 'Cancel' }).click()
        await dialog.waitFor({ state: 'hidden' })
        expect(onDisk()).toEqual([false, false, false])
      },
      30_000 * PATIENCE,
    )

    test(
      'one project is fixed alone: its set rewritten, its sample copied, a backup kept',
      async () => {
        const original = readFileSync(setOf('Other Project'))
        dated = statSync(setOf('Other Project')).mtimeMs
        await page.getByRole('button', { name: 'Fix Other Project' }).click()
        const dialog = page.getByRole('dialog')
        await dialog.getByTestId('review-continue').click()
        await dialog.getByRole('button', { name: 'Fix 1 set' }).click()
        await dialog.getByTestId('review-done').waitFor({ timeout: 30_000 * PATIENCE })
        expect(await textOf(dialog.getByTestId('review-fix'))).toContain(
          'Fixed: 1 set rewritten, 1 file copied (2.0 MB).',
        )
        await closeWith(dialog, dialog.getByTestId('review-done'))
        expect(onDisk()).toEqual([false, true, false])
        expect(existsSync(join(projects, 'Other Project', 'Samples', 'Imported', '1.wav'))).toBe(
          true,
        )
        const backups = readdirSync(join(projects, 'Other Project', 'Backup'))
        expect(backups).toHaveLength(1)
        expect(
          readFileSync(join(projects, 'Other Project', 'Backup', backups[0] as string)).equals(
            original,
          ),
        ).toBe(true)
        // The set was saved by the fix and is dated so; its backup keeps the date it had.
        expect(statSync(setOf('Other Project')).mtimeMs).toBeGreaterThan(dated)
        expect(
          Math.abs(
            statSync(join(projects, 'Other Project', 'Backup', backups[0] as string)).mtimeMs -
              dated,
          ),
        ).toBeLessThan(1)
        // The page scans again by itself: two projects are left to fix.
        const left = ['Fix Brokenpath Project', 'Fix Third Project']
        expect(await eventually(fixButtons, left)).toEqual(left)
        await goTo('Overview')
        await rescanned('2 sets in 2 projects')
        expect(await textOf(page.getByTestId('fixed'))).toContain(
          'Fixed: 1 set rewritten, 1 file copied (2.0 MB).',
        )
      },
      60_000 * PATIENCE,
    )

    test(
      'undo takes the fix back',
      async () => {
        await page.getByTestId('fixed').getByRole('button', { name: 'Undo this fix' }).click()
        await page.getByTestId('undone').waitFor({ timeout: 30_000 * PATIENCE })
        expect(await textOf(page.getByTestId('undone'))).toContain(
          'Undone: 1 set restored, 2 files moved to the Trash.',
        )
        expect(onDisk()).toEqual([false, false, false])
        expect(existsSync(join(projects, 'Other Project', 'Samples', 'Imported', '1.wav'))).toBe(
          false,
        )
        // With its content, the set has its old date again.
        expect(Math.abs(statSync(setOf('Other Project')).mtimeMs - dated)).toBeLessThan(1)
        await rescanned('3 sets in 3 projects')
      },
      60_000 * PATIENCE,
    )

    test(
      'a selection of projects is fixed in one run, which one undo takes back',
      async () => {
        await goTo('Samples')
        await rows().first().waitFor()
        for (const project of ['Brokenpath Project', 'Third Project'])
          await page.getByRole('checkbox', { name: `Select ${project}` }).click()
        await page.getByTestId('fix-selected').click()
        const dialog = page.getByRole('dialog')
        expect(await dialog.getByRole('heading', { level: 2 }).innerText()).toBe('Fix 2 projects')
        expect(
          await dialog.getByLabel('Projects that are fixed').locator('li').allInnerTexts(),
        ).toEqual(['Brokenpath Project\n1 set', 'Third Project\n1 set'])
        await dialog.getByTestId('review-continue').click()
        await dialog.getByRole('button', { name: 'Fix 2 sets' }).click()
        await dialog.getByTestId('review-done').waitFor({ timeout: 30_000 * PATIENCE })
        expect(onDisk()).toEqual([true, false, true])
        // The result offers the undo as well.
        await dialog.getByRole('button', { name: 'Undo this fix' }).click()
        await goTo('Overview')
        await page.getByTestId('undone').waitFor({ timeout: 30_000 * PATIENCE })
        expect(onDisk()).toEqual([false, false, false])
        await rescanned('3 sets in 3 projects')
      },
      60_000 * PATIENCE,
    )

    test(
      'Review and fix fixes every project, and then nothing is left to fix',
      async () => {
        await page.getByTestId('review').click()
        const dialog = page.getByRole('dialog')
        expect(await dialog.getByRole('heading', { level: 2 }).innerText()).toBe('Fix all projects')
        await dialog.getByTestId('review-continue').click()
        await dialog.getByRole('button', { name: 'Fix 3 sets' }).click()
        await dialog.getByTestId('review-done').waitFor({ timeout: 30_000 * PATIENCE })
        await closeWith(dialog, dialog.getByTestId('review-done'))
        await page
          .getByTestId('fix-card')
          .getByText('Nothing to fix')
          .waitFor({ timeout: 30_000 * PATIENCE })
        expect(onDisk()).toEqual([true, true, true])
        expect(await page.locator('#headline').innerText()).toBe('All 5 sets are complete')
        expect(await textOf(page.getByTestId('fixed'))).toContain(
          'Fixed: 3 sets rewritten, 3 files copied (6.0 MB).',
        )
        await goTo('Samples')
        await rows().first().waitFor()
        expect(await eventually(fixButtons, [])).toEqual([])
        expect(await page.getByTestId('fix-all').count()).toBe(0)
      },
      60_000 * PATIENCE,
    )

    test(
      'the next visit shows the scan without scanning, and can still undo the last fix',
      async () => {
        await page.reload()
        // A reload stays where it was: the place is part of the address.
        await page.getByRole('heading', { level: 1, name: 'Samples', exact: true }).waitFor()
        await rows().first().waitFor()
        await goTo('Overview')
        await page.getByTestId('last-fix').waitFor()
        // The scan livesaver kept is there at once.
        expect(await page.locator('#headline').innerText()).toBe('All 5 sets are complete')
        expect(await page.getByTestId('scanned-at').innerText()).toMatch(/^Scanned \d\d:\d\d$/)
        expect(await textOf(page.getByTestId('last-fix'))).toMatch(
          /^The last fix, \d\d:\d\d, rewrote 3 sets and copied 3 files\./,
        )
        await goTo('Settings')
        expect(await page.getByTestId('folder-name').allInnerTexts()).toEqual([
          'projects',
          'samples',
        ])
        await goTo('Overview')
        await page.getByTestId('last-fix').getByRole('button', { name: 'Undo this fix' }).click()
        await page.getByTestId('undone').waitFor({ timeout: 30_000 * PATIENCE })
        expect(onDisk()).toEqual([false, false, false])
        await rescanned('3 sets in 3 projects')
        // Nothing older is left to undo: the earlier fixes were undone before.
        expect(await page.getByRole('button', { name: /^Undo/ }).count()).toBe(0)
      },
      60_000 * PATIENCE,
    )

    test(
      'changing a folder after the scan is said, and a fix still does what was scanned',
      async () => {
        await goTo('Settings')
        await page.getByRole('checkbox', { name: 'Contains installed libraries' }).click()
        await goTo('Overview')
        expect(await textOf(page.getByTestId('stale'))).toContain(
          'You changed folders or options after this scan',
        )
        expect(await page.getByTestId('scanned-at').innerText()).toMatch(/^Changed since the scan/)
        await page.getByTestId('stale').getByRole('button', { name: 'Scan again' }).click()
        await page.getByTestId('stale').waitFor({ state: 'hidden', timeout: 30_000 * PATIENCE })
        await rescanned('3 sets in 3 projects')
        expect(await page.getByTestId('scanned-at').innerText()).toMatch(/^Scanned \d\d:\d\d$/)
      },
      60_000 * PATIENCE,
    )

    test('the page reported no errors, and asked nothing outside its own address', () => {
      expect(problems).toEqual([])
      expect(outside).toEqual([])
    })
  })
}
