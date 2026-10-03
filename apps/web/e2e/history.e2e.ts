/**
 * The history, in the three browser engines, with livesaver behind the app: every run with what
 * it did, its details and reports, and its undo, which asks first. Fixes and undos really write:
 * to copies of the fixtures in a temporary folder.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { copyFixtures, readSet, tempDir } from '@livesaver/test-kit'
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
  describe(`the history in ${name}`, () => {
    let browser: Browser
    let page: Page
    let server: WebServer
    let tmp: { path: string; cleanup: () => void }
    let projects: string
    let problems: string[]
    let outside: string[]
    const revealed: string[] = []

    beforeAll(async () => {
      tmp = tempDir()
      const copied = copyFixtures(tmp.path)
      projects = copied.projects
      cpSync(join(projects, 'Brokenpath Project'), join(projects, 'Other Project'), {
        recursive: true,
      })
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
      // Runs from before: a plan made on the command line, and a run of a version of livesaver
      // that did not note what it was asked.
      const runs = join(tmp.path, 'home', 'runs')
      const planned = join(runs, '2025-03-04_101500_collect_dry-run')
      mkdirSync(planned, { recursive: true })
      writeFileSync(
        join(planned, 'run.json'),
        JSON.stringify({
          version: 1,
          command: 'collect',
          apply: false,
          targets: [projects],
          options: { search: [copied.samples], packLimit: 50 },
          started: new Date(2025, 2, 4, 10, 15).toISOString(),
          ended: new Date(2025, 2, 4, 10, 16).toISOString(),
          outcome: { sets: 4, changingSets: 2 },
        }),
      )
      writeFileSync(join(planned, 'overview.md'), '# A plan\n')
      mkdirSync(join(runs, '2025-03-02_090000_collect_apply'))
      server = await startWeb({
        assets: DIST,
        config,
        force: true,
        plugins: noPlugins,
        reveal: async (path) => {
          revealed.push(path)
        },
      })
      browser = await type.launch()
      ;({ page, problems, outside } = await watch(browser, server.url))
      await page.goto(`${server.url}#/history`)
      await page.getByRole('heading', { level: 1, name: 'History', exact: true }).waitFor()
    }, 60_000)
    afterAll(async () => {
      await browser?.close()
      if (server) await idle(server)
      await server?.close()
      tmp?.cleanup()
    })

    const setOf = (project: string) => join(projects, project, 'Brokenpath.als')
    const fixedOnDisk = (project: string) => readSet(setOf(project)).includes('Samples/Imported')
    const onDisk = () => ['Brokenpath Project', 'Other Project'].map(fixedOnDisk)
    const goTo = async (place: string) => {
      await page.getByRole('link', { name: place, exact: true }).click()
      await page.getByRole('heading', { level: 1, name: place, exact: true }).waitFor()
    }
    const runs = () => page.getByTestId('run')
    /** Each run as its title (with what became of it) and what is said below it, the time left out. */
    const listed = async () =>
      (
        await runs().evaluateAll((rows) =>
          rows.map((row) =>
            [...row.querySelectorAll('p')].map((p) =>
              (p.textContent ?? '').replace(/\s+/g, ' ').trim(),
            ),
          ),
        )
      ).map(([title, facts]) => [title, (facts ?? '').replace(/^\d\d:\d\d( · )?/, '')])
    const undoButtons = () =>
      page
        .getByRole('button', { name: /^Undo: / })
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')))
    /** What the app says in passing, at the edge of the page. */
    const toasts = () => page.getByRole('region', { name: /^Notifications/ }).locator('li')
    const rescanned = async (fixable: string) => {
      await page.getByTestId('progress').waitFor({ state: 'hidden', timeout: 30_000 })
      await page.getByTestId('fix-card').getByText(fixable).waitFor({ timeout: 30_000 })
    }

    test('before anything was changed it says so, and the runs that changed nothing can be seen', async () => {
      const empty = page.getByTestId('no-runs')
      await empty.waitFor()
      expect(await textOf(empty)).toContain('Nothing was changed yet')
      expect(await textOf(empty)).toContain('planned and reported 2 times so far')
      await page.getByTestId('all-runs').click()
      await runs().first().waitFor()
      expect(await page.getByRole('heading', { level: 2 }).allInnerTexts()).toEqual([
        'Tuesday, 4 March 2025',
        'Sunday, 2 March 2025',
      ])
      expect(await listed()).toEqual([
        ['Planned a fix (nothing was written)', 'In projects'],
        ['A fix with nothing to do', ''],
      ])
      expect(await undoButtons()).toEqual([])

      await page.getByRole('button', { name: 'Details: A fix with nothing to do' }).click()
      const panel = page.getByRole('dialog')
      await panel.getByText('It changed nothing.').waitFor()
      expect(await textOf(panel)).toContain('An older version of livesaver made this run')
      await page.keyboard.press('Escape')
      await panel.waitFor({ state: 'hidden' })

      await page.getByRole('button', { name: 'Details: Planned a fix' }).click()
      await panel.getByText('It changed nothing.').waitFor()
      const text = await textOf(panel)
      expect(text).toContain('Started 4 March 2025, 10:15')
      expect(text).toContain('livesaver collect (a dry run: nothing is written)')
      expect(text).toContain('Pack files copied up to 50 MB')
      expect(text).toContain('Sets with something to change 2')
      expect(await panel.getByRole('button', { name: /^Undo/ }).count()).toBe(0)
      // Its report is there to download, as it was written.
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        panel.getByRole('button', { name: 'Overview' }).click(),
      ])
      expect(download.suggestedFilename()).toBe('overview.md')
      expect(await Bun.file(await download.path()).text()).toBe('# A plan\n')
      await page.keyboard.press('Escape')
      await panel.waitFor({ state: 'hidden' })
      await page.getByTestId('all-runs').click()
      await empty.waitFor()
    }, 60_000)

    test('a fix made on another page is said there, with its undo within reach', async () => {
      await goTo('Overview')
      await page.getByTestId('scan-library').click()
      await rescanned('2 sets in 2 projects')
      await goTo('Samples')
      await page.getByRole('button', { name: 'Fix Other Project' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByTestId('review-continue').click()
      await dialog.getByRole('button', { name: 'Fix 1 set' }).click()
      await dialog.getByTestId('review-done').waitFor({ timeout: 30_000 })
      await dialog.getByTestId('review-done').click()
      const toast = toasts().filter({ hasText: 'Fixed: ' })
      await toast.waitFor()
      expect(await textOf(toast)).toContain('Fixed: 1 set rewritten, 1 file copied (2.0 MB)')
      expect(onDisk()).toEqual([false, true])
      // The undo waits for the scan that follows a fix, and says what it did.
      await toast.getByRole('button', { name: 'Undo' }).click()
      const undone = toasts().filter({ hasText: 'Undone: ' })
      await undone.waitFor({ timeout: 30_000 })
      expect(await textOf(undone)).toContain('Undone: 1 set restored, 2 files moved to the Trash')
      expect(onDisk()).toEqual([false, false])
      const left = ['Fix Brokenpath Project', 'Fix Other Project']
      const fixButtons = () =>
        page
          .locator('table tbody button[aria-label^="Fix "]')
          .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')))
      expect(await eventually(fixButtons, left)).toEqual(left)
    }, 90_000)

    test('every run is listed with what it did, and the overview shows the last ones', async () => {
      await goTo('Overview')
      await rescanned('2 sets in 2 projects')
      await page.getByTestId('review').click()
      const dialog = page.getByRole('dialog')
      await dialog.getByTestId('review-continue').click()
      await dialog.getByRole('button', { name: 'Fix 2 sets' }).click()
      await dialog.getByTestId('review-done').waitFor({ timeout: 30_000 })
      await dialog.getByTestId('review-done').click()
      await page.getByTestId('fix-card').getByText('Nothing to fix').waitFor({ timeout: 30_000 })
      expect(onDisk()).toEqual([true, true])

      const recent = page.getByTestId('recent-runs')
      expect(await textsOf(recent.locator('li > span:first-child'))).toEqual([
        'Fixed 2 sets, copied 2 files',
        'Fixed 1 set, copied 1 fileUndone',
      ])
      await recent.getByRole('link', { name: 'See the history' }).click()
      await page.getByRole('heading', { level: 1, name: 'History', exact: true }).waitFor()
      await runs().first().waitFor()
      expect(await page.getByRole('heading', { level: 2 }).allInnerTexts()).toEqual(['Today'])
      expect(await listed()).toEqual([
        ['Fixed 2 sets, copied 2 files', 'In projects'],
        ['Fixed 1 set, copied 1 file Undone', 'In Other Project'],
      ])
      expect(await textOf(page.getByTestId('history-intro'))).toContain(
        '2 more runs only planned or reported.',
      )
      // Only what still stands can be undone.
      expect(await undoButtons()).toEqual(['Undo: Fixed 2 sets, copied 2 files'])
    }, 90_000)

    test('a run in full: what it was asked, how it ended, its reports and every step', async () => {
      await page.getByRole('button', { name: 'Details: Fixed 2 sets, copied 2 files' }).click()
      const panel = page.getByRole('dialog')
      await panel.getByTestId('steps').waitFor()
      const text = await textOf(panel)
      expect(text).toContain('livesaver collect --apply')
      expect(text).toContain(`On ${projects}`)
      expect(text).toContain('Sets rewritten 2')
      expect(text).toContain('Files copied 2')
      expect(text).toContain('Size of the copies 4.0 MB')
      expect(text).toContain('What it changed · 4 steps')
      const steps = panel.getByTestId('steps').locator('li')
      expect(await textsOf(steps.locator('div > span:first-child'))).toEqual([
        'File copied',
        'Set rewritten',
        'File copied',
        'Set rewritten',
      ])
      expect(await textOf(steps.nth(1))).toContain('backup: ')
      expect(await textOf(steps.nth(1))).toContain('/Backup/Brokenpath [')

      const [download] = await Promise.all([
        page.waitForEvent('download'),
        panel.getByRole('button', { name: 'Changes', exact: true }).click(),
      ])
      expect(download.suggestedFilename()).toBe('changes.csv')
      expect(await Bun.file(await download.path()).text()).toContain('Brokenpath.als')

      // Where a step left its file, on this computer.
      await steps
        .nth(1)
        .getByRole('button', { name: /^Show in Finder/ })
        .click()
      expect(await eventually(async () => revealed.length, 1)).toBe(1)
      expect(revealed[0]).toMatch(/Project\/Brokenpath\.als$/)
      expect(await barriers(page)).toEqual([])
    }, 60_000)

    test('an undo from the history asks first, then takes the run back and scans again', async () => {
      const panel = page.getByRole('dialog').filter({ has: page.getByTestId('run-panel') })
      await panel.getByTestId('run-undo').click()
      const confirm = page.getByRole('dialog').filter({ has: page.getByTestId('undo-lines') })
      await confirm.getByTestId('undo-lines').waitFor()
      expect(await confirm.getByRole('heading', { level: 2 }).innerText()).toBe('Undo this run?')
      expect(await textsOf(confirm.getByTestId('undo-lines').locator('li'))).toEqual([
        '2 sets go back to what they were before the run, from the originals livesaver kept.',
        '2 copied files are moved to the Trash, unless another set uses them by now.',
        'What was changed since the run is left alone, and reported.',
      ])
      expect(await barriers(page)).toEqual([])
      await confirm.getByRole('button', { name: 'Cancel' }).click()
      await confirm.waitFor({ state: 'hidden' })
      expect(onDisk()).toEqual([true, true])

      await panel.getByTestId('run-undo').click()
      await confirm.getByTestId('undo-confirm').click()
      const said = page.getByTestId('history-undone')
      await said.waitFor({ timeout: 30_000 })
      expect(await textOf(said)).toContain('Undone: 2 sets restored, 4 files moved to the Trash.')
      expect(onDisk()).toEqual([false, false])
      // The panel that is still open says what became of the run and of each step.
      await panel.getByText('moved to the Trash').first().waitFor()
      const steps = panel.getByTestId('steps').locator('li')
      expect(await textsOf(steps.locator('div > span:last-child'))).toEqual([
        'moved to the Trash',
        'restored',
        'moved to the Trash',
        'restored',
      ])
      expect(await panel.getByRole('button', { name: /^(Undo|Show in Finder)/ }).count()).toBe(0)
      await page.keyboard.press('Escape')
      await panel.waitFor({ state: 'hidden' })
      expect(await listed()).toEqual([
        ['Fixed 2 sets, copied 2 files Undone', 'In projects'],
        ['Fixed 1 set, copied 1 file Undone', 'In Other Project'],
      ])
      expect(await undoButtons()).toEqual([])

      // Elsewhere, nothing still offers to undo it, and both sets are there to fix again.
      await goTo('Overview')
      await rescanned('2 sets in 2 projects')
      expect(await page.getByTestId('fixed').count()).toBe(0)
      expect(await page.getByTestId('last-fix').count()).toBe(0)
    }, 90_000)

    test('a run is undone from its row as well, after the same question', async () => {
      await page.getByTestId('review').click()
      const dialog = page.getByRole('dialog')
      await dialog.getByTestId('review-continue').click()
      await dialog.getByRole('button', { name: 'Fix 2 sets' }).click()
      await dialog.getByTestId('review-done').waitFor({ timeout: 30_000 })
      await dialog.getByTestId('review-done').click()
      await page.getByTestId('fix-card').getByText('Nothing to fix').waitFor({ timeout: 30_000 })
      await goTo('History')
      await page.getByRole('button', { name: 'Undo: Fixed 2 sets, copied 2 files' }).click()
      await page.getByTestId('undo-confirm').click()
      await page.getByTestId('history-undone').waitFor({ timeout: 30_000 })
      expect(onDisk()).toEqual([false, false])
      expect(await undoButtons()).toEqual([])
      await page.getByTestId('progress').waitFor({ state: 'hidden', timeout: 30_000 })
    }, 90_000)

    test('in dark too, nothing on these screens keeps anyone out', async () => {
      const dark = await watch(browser, server.url, 'dark')
      await dark.page.goto(`${server.url}#/history`)
      await dark.page.getByTestId('run').first().waitFor()
      expect(await barriers(dark.page)).toEqual([])
      await dark.page
        .getByRole('button', { name: /^Details: / })
        .first()
        .click()
      await dark.page.getByTestId('steps').waitFor()
      expect(await barriers(dark.page)).toEqual([])
      expect(dark.problems).toEqual([])
      await dark.page.context().close()
    }, 60_000)

    test('the page reported no errors, and asked nothing outside its own address', () => {
      expect(problems).toEqual([])
      expect(outside).toEqual([])
    })
  })
}
