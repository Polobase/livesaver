/**
 * Fixing in the page itself, where a browser lets a page edit a folder (Chromium). The folder
 * dialog cannot be driven by a test, and no test browser lets a page write to a folder of the
 * disk without a person saying yes: so the project folder lies in the browser's own file
 * system here, behind the same handles a folder of the disk has, and the test hands it out in
 * place of the dialog. What the page wrote is compared with what the command line writes on a
 * copy of the same projects on disk.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { copyFixtures, fileRefBodies, readSet, stripSampleRefs, tempDir } from '@livesaver/test-kit'
import type { Browser, Page } from 'playwright'
import { build } from '../build.js'
import { serve } from '../serve.js'
import { filesIn, fill, handOut, sha1, unstamped, written, xml } from './handed.js'
import {
  barriers,
  closeWith,
  dropFolder,
  ENGINES,
  giveFolder,
  PATIENCE,
  textOf,
  type Watched,
  watch,
} from './support.js'

let site: { url: string; stop: () => void }
beforeAll(async () => {
  await build()
  site = serve()
}, 120_000 * PATIENCE)
afterAll(() => site?.stop())

const REPO = join(import.meta.dir, '..', '..', '..')
const SET = 'Brokenpath Project/Brokenpath.als'
const COPY = 'Brokenpath Project/Samples/Imported/1.wav'

for (const [name, type] of ENGINES) {
  describe(`fixing in the page in ${name}`, () => {
    let browser: Browser
    let watched: Watched
    let page: Page
    let tmp: { path: string; cleanup: () => void }
    let projects: string
    let samples: string
    const can = name === 'Chromium'

    beforeAll(async () => {
      tmp = tempDir()
      ;({ projects, samples } = copyFixtures(tmp.path))
      browser = await type.launch()
      watched = await watch(browser, site.url)
      page = watched.page
      if (can) await handOut(page)
      await page.goto(site.url)
      await page.getByTestId('search-folders').waitFor()
    }, 60_000 * PATIENCE)
    afterAll(async () => {
      await browser?.close()
      tmp?.cleanup()
    })

    const goTo = async (place: string) => {
      await page.getByRole('link', { name: place, exact: true }).click()
      await page.getByRole('heading', { level: 1, name: place, exact: true }).waitFor()
    }
    const section = () => page.getByTestId('writing')
    const projectRows = () => page.getByTestId('projects-folders').getByTestId('folder-row')
    /** Types where a folder lies on disk: a fix writes it into the sets. */
    const place = async (list: string, path: string) => {
      const row = page.getByTestId(list).getByTestId('folder-row').first()
      await row.getByRole('button', { name: /^(Set|Change) path$/ }).click()
      await row.getByRole('textbox').fill(path)
      await row.getByRole('button', { name: 'Done' }).click()
    }
    const scan = async (fixable: string) => {
      await page.getByTestId('scan').click()
      await page.getByTestId('progress').waitFor({ state: 'hidden', timeout: 30_000 * PATIENCE })
      await page
        .getByTestId('fix-card')
        .getByText(fixable)
        .waitFor({ timeout: 30_000 * PATIENCE })
    }

    if (!can) {
      test(
        'the browser lets no page edit a folder: the settings say so, and how to fix all the same',
        async () => {
          await goTo('Settings')
          const impossible = section().getByTestId('writing-impossible')
          expect(await textOf(impossible)).toContain(
            'This browser does not let a page edit a folder, so this page only reads.',
          )
          expect(await section().getByRole('switch').count()).toBe(0)
          expect(await impossible.getByRole('link', { name: /livesaver/ }).count()).toBe(1)
          expect(await barriers(page)).toEqual([])
          expect(watched.problems).toEqual([])
          expect(watched.outside).toEqual([])
        },
        60_000 * PATIENCE,
      )
      return
    }

    test(
      'it is off, and a project folder that was added before can only be read',
      async () => {
        await goTo('Settings')
        await giveFolder(page, 'projects-input', projects)
        await giveFolder(page, 'search-input', samples)
        await place('projects-folders', projects)
        await place('search-folders', samples)
        const toggle = section().getByRole('switch', { name: /Fix in this browser/ })
        expect(await toggle.getAttribute('aria-checked')).toBe('false')
        expect(await textOf(section())).toContain('Off. This page only reads.')
        // Nothing says what the page may do in a folder while it only reads anyway.
        expect(await page.getByTestId('folder-access').count()).toBe(0)

        await goTo('Overview')
        await scan('1 set in 1 project')
        const card = page.getByTestId('fix-card')
        expect(await card.getByTestId('review').count()).toBe(0)
        expect(await textOf(card.getByTestId('can-write-here'))).toContain(
          'Your browser can also let this page fix on its own, as an experiment with limits.',
        )
        await card.getByRole('link', { name: 'Switch it on in the Settings' }).click()
        await page.getByRole('heading', { level: 1, name: 'Settings' }).waitFor()
      },
      60_000 * PATIENCE,
    )

    test(
      'switching it on means reading what a page cannot do, and saying so',
      async () => {
        const toggle = section().getByRole('switch', { name: /Fix in this browser/ })
        await toggle.click()
        const dialog = page.getByRole('dialog')
        await dialog.getByTestId('writing-limits').waitFor()
        const limits = await textOf(dialog.getByTestId('writing-limits'))
        for (const said of [
          'It cannot see whether Ableton Live is running.',
          'A rewritten set loses its Finder tags and its Finder comment.',
          'The undo is kept by this browser, for this site.',
          'Your browser hides files with some names from a page.',
          'A page has no Trash.',
          'It cannot see how much room is left on your disk.',
        ])
          expect(limits).toContain(said)
        expect(await barriers(page)).toEqual([])
        // Not without the tick; and closing the dialog leaves it off.
        const confirm = dialog.getByTestId('writing-confirm')
        expect(await confirm.isDisabled()).toBe(true)
        await closeWith(dialog, dialog.getByRole('button', { name: 'Cancel' }))
        expect(await toggle.getAttribute('aria-checked')).toBe('false')

        await toggle.click()
        await dialog.getByRole('checkbox', { name: /I have read this/ }).check()
        await closeWith(dialog, confirm)
        expect(await toggle.getAttribute('aria-checked')).toBe('true')
        expect(await textOf(section())).toContain(
          'On. Project folders are chosen for editing from now on.',
        )
        // The folder that was uploaded stays what it is: to be read.
        expect(await textOf(section())).toContain(
          'The project folders you added before can only be read.',
        )
        expect(await textOf(projectRows().first().getByTestId('folder-access'))).toBe(
          'Added to be read only. To fix in it, remove it and add it again with “Add folder”.',
        )
        expect(await barriers(page)).toEqual([])
      },
      60_000 * PATIENCE,
    )

    test(
      'a fix waits until the page may edit the project folder, and until Live is said to be closed',
      async () => {
        await goTo('Overview')
        await page.getByTestId('review').click()
        const dialog = page.getByRole('dialog')
        await dialog.getByTestId('review-continue').click()
        const ready = dialog.getByTestId('review-ready')
        expect(await textOf(ready.getByTestId('ready-editable'))).toContain(
          'This page may not edit your project folders yet “projects” was added to be read only.',
        )
        const apply = dialog.getByTestId('review-apply')
        await dialog.getByRole('checkbox', { name: 'Ableton Live is closed' }).check()
        expect(await apply.isDisabled()).toBe(true)
        await closeWith(dialog, dialog.getByRole('button', { name: 'Cancel' }))

        // The folder of the disk itself, dropped: the page gets its handle, reads through it at
        // once, and has to ask before it may edit. (A test browser lets no page write to the
        // disk: asked, it says no, and the page says so.)
        await goTo('Settings')
        await projectRows().first().getByRole('button', { name: 'Remove projects' }).click()
        await dropFolder(page, page.getByTestId('projects-folders'), projects)
        const access = projectRows().first().getByTestId('folder-access')
        await access.getByRole('button', { name: 'Allow editing' }).waitFor()
        expect(await textOf(access)).toContain('Can only be read so far.')
        await access.getByRole('button', { name: 'Allow editing' }).click()
        await access.getByText('Your browser did not allow it.').waitFor()
        await place('projects-folders', projects)
        await goTo('Overview')
        await scan('1 set in 1 project')
        await page.getByTestId('review').click()
        await dialog.getByTestId('review-continue').click()
        expect(await textOf(ready.getByTestId('ready-editable'))).toContain(
          'This page may not edit your project folders yet “projects” can only be read so far.',
        )
        await ready.getByTestId('allow-editing').waitFor()
        await dialog.getByRole('checkbox', { name: 'Ableton Live is closed' }).check()
        expect(await apply.isDisabled()).toBe(true)
        await closeWith(dialog, dialog.getByRole('button', { name: 'Cancel' }))
        // Nothing was written to the disk.
        expect(filesIn(projects).sort()).toEqual(filesIn(fixturesProjects()).sort())

        // Chosen with the browser's folder dialog, the page may edit it.
        await goTo('Settings')
        await projectRows().first().getByRole('button', { name: 'Remove projects' }).click()
        await fill(page, projects)
        await page
          .getByTestId('projects-folders')
          .getByRole('button', { name: 'Add folder' })
          .click()
        await projectRows().first().waitFor()
        expect(await textOf(projectRows().first().getByTestId('folder-access'))).toBe(
          'This page may edit it: it can be fixed here.',
        )
        await place('projects-folders', projects)
        await goTo('Overview')
        await scan('1 set in 1 project')

        await page.getByTestId('review').click()
        await dialog.getByTestId('review-continue').click()
        expect(await textOf(ready.getByTestId('ready-editable'))).toContain(
          'This page may edit your project folders',
        )
        expect(await textOf(ready.getByTestId('ready-placed'))).toContain(
          'It is known where your folders lie on your disk',
        )
        expect(await textOf(ready)).toContain('A page cannot see whether Live is running.')
        expect(await textOf(ready)).toContain('What the undo needs is kept by this browser')
        // Unticked again, since the review was opened anew: nothing is taken for granted.
        expect(await apply.isDisabled()).toBe(true)
        expect(await barriers(page)).toEqual([])
        await dialog.getByRole('checkbox', { name: 'Ableton Live is closed' }).check()
        expect(await apply.isDisabled()).toBe(false)
        await closeWith(dialog, dialog.getByRole('button', { name: 'Cancel' }))
      },
      90_000 * PATIENCE,
    )

    test(
      'the fix writes what the command line writes: the set, the copy, the backup',
      async () => {
        const original = readFileSync(join(projects, SET))
        await page.getByTestId('review').click()
        const dialog = page.getByRole('dialog')
        await dialog.getByTestId('review-continue').click()
        await dialog.getByRole('checkbox', { name: 'Ableton Live is closed' }).check()
        await dialog.getByTestId('review-apply').click()
        await dialog.getByTestId('review-done').waitFor({ timeout: 30_000 * PATIENCE })
        expect(await textOf(dialog.getByTestId('review-fix'))).toContain(
          'Fixed: 1 set rewritten, 1 file copied',
        )
        await closeWith(dialog, dialog.getByTestId('review-done'))
        await page
          .getByTestId('fix-card')
          .getByText('Nothing to fix')
          .waitFor({
            timeout: 30_000 * PATIENCE,
          })

        // The command line on the same projects, on disk. (Its settings and its state are the
        // test's own; Live may well run on this computer, which is nothing to these copies.)
        const config = join(tmp.path, 'config.json')
        writeFileSync(config, JSON.stringify({ appResources: '', vendorLibraries: [] }))
        const run = Bun.spawnSync(
          [
            process.execPath,
            join(REPO, 'packages/cli/src/bin.ts'),
            'collect',
            projects,
            ...['--search', samples, '--no-default-search', '--config', config],
            ...['--apply', '--force', '--quiet'],
          ],
          {
            env: {
              ...process.env,
              LIVESAVER_HOME: join(tmp.path, 'home'),
              LIVESAVER_TRASH_DIR: join(tmp.path, 'trash'),
              NO_COLOR: '1',
            },
          },
        )
        expect([run.exitCode, run.stderr.toString()]).toEqual([0, ''])

        const mine = await written(page)
        const theirs = filesIn(projects)
        expect([...mine.keys()].map(unstamped).sort()).toEqual(theirs.map(unstamped).sort())
        // The set points where the command line's points, and nothing else in it changed.
        const [here, there] = [xml(mine.get(SET)?.data), readSet(join(projects, SET))]
        expect(fileRefBodies(here)).toEqual(fileRefBodies(there))
        expect(stripSampleRefs(here)).toBe(stripSampleRefs(there))
        expect(here).toContain(`${projects}/Brokenpath Project/Samples/Imported/1.wav`)
        // Every other file is the same, byte for byte: the copy, its analysis file, the backup.
        for (const path of theirs) {
          if (path === SET) continue
          const twin = [...mine].find(([other]) => unstamped(other) === unstamped(path))
          expect([path, twin?.[1].sha1]).toEqual([path, sha1(readFileSync(join(projects, path)))])
        }
        const backup = [...mine].find(([path]) => path.startsWith('Brokenpath Project/Backup/'))
        expect(backup?.[1].sha1).toBe(sha1(original))
      },
      90_000 * PATIENCE,
    )

    test(
      'the fix is in the history, and its undo puts the set back byte for byte',
      async () => {
        const original = sha1(readFileSync(join(fixturesProjects(), SET)))
        expect(await textOf(page.getByTestId('fixed'))).toContain('1 set rewritten')
        await goTo('History')
        const run = page.getByTestId('run').first()
        expect(await textOf(run)).toContain('Fixed 1 set, copied 1 file')
        expect(await textOf(page.getByTestId('history-intro'))).toContain(
          'What livesaver changed from this browser',
        )
        await page
          .getByRole('button', { name: /^Details: / })
          .first()
          .click()
        await page.getByTestId('steps').waitFor()
        expect(await textOf(page.getByTestId('steps'))).toContain('Set rewritten')
        expect(await barriers(page)).toEqual([])
        await page.keyboard.press('Escape')

        await page.getByRole('button', { name: 'Undo: Fixed 1 set, copied 1 file' }).click()
        const confirm = page.getByRole('dialog')
        expect(await textOf(confirm.getByTestId('undo-lines'))).toContain(
          '1 copied file is moved to the hidden folder “.livesaver-trash” of the project folder',
        )
        expect(await textOf(confirm)).toContain('this page cannot see whether it is: quit it first')
        await closeWith(confirm, confirm.getByTestId('undo-confirm'))
        const undone = page.getByTestId('history-undone')
        await undone.waitFor({ timeout: 30_000 * PATIENCE })
        expect(await textOf(undone)).toContain(
          'Undone: 1 set restored, 2 files moved to the hidden folder “.livesaver-trash” of the project folder.',
        )

        const files = await written(page)
        expect(files.get(SET)?.sha1).toBe(original)
        expect(files.has(COPY)).toBe(false)
        expect([...files.keys()].map(unstamped)).toContain(`.livesaver-trash/[when]/${COPY}`)
        // The scan that follows finds the set to fix again, and not the copy that was taken out.
        await goTo('Overview')
        await page
          .getByTestId('fix-card')
          .getByText('1 set in 1 project')
          .waitFor({ timeout: 30_000 * PATIENCE })
      },
      90_000 * PATIENCE,
    )

    test(
      'one project is fixed from the list of projects, and taken back from the overview',
      async () => {
        const original = sha1(readFileSync(join(fixturesProjects(), SET)))
        await goTo('Samples')
        await page.getByRole('button', { name: 'Fix Brokenpath Project' }).click()
        const dialog = page.getByRole('dialog')
        expect(await dialog.getByRole('heading', { level: 2 }).innerText()).toBe(
          'Fix "Brokenpath Project"',
        )
        await dialog.getByTestId('review-continue').click()
        await dialog.getByRole('checkbox', { name: 'Ableton Live is closed' }).check()
        // Which project was chosen goes to the page's worker with the fix: it has to arrive.
        await dialog.getByTestId('review-apply').click()
        await dialog.getByTestId('review-done').waitFor({ timeout: 30_000 * PATIENCE })
        expect(await textOf(dialog.getByTestId('review-fix'))).toContain(
          'Fixed: 1 set rewritten, 1 file copied',
        )
        await closeWith(dialog, dialog.getByTestId('review-done'))
        expect(xml((await written(page)).get(SET)?.data)).toContain('Samples/Imported/1.wav')

        await goTo('Overview')
        await page.getByTestId('progress').waitFor({ state: 'hidden', timeout: 30_000 * PATIENCE })
        await page.getByTestId('fixed').getByRole('button', { name: 'Undo this fix' }).click()
        await page.getByTestId('undone').waitFor({ timeout: 30_000 * PATIENCE })
        expect((await written(page)).get(SET)?.sha1).toBe(original)
        await page
          .getByTestId('fix-card')
          .getByText('1 set in 1 project')
          .waitFor({ timeout: 30_000 * PATIENCE })
      },
      90_000 * PATIENCE,
    )

    test(
      'after a reload it is still on and the run is still listed; switched off, the page only reads',
      async () => {
        await page.reload()
        await page.getByTestId('search-folders').waitFor()
        await goTo('History')
        expect(await textOf(page.getByTestId('run').first())).toContain('Undone')
        await goTo('Settings')
        const toggle = section().getByRole('switch', { name: /Fix in this browser/ })
        expect(await toggle.getAttribute('aria-checked')).toBe('true')
        await toggle.click()
        expect(await toggle.getAttribute('aria-checked')).toBe('false')
        await goTo('History')
        await page.getByTestId('no-history').waitFor()
        expect(await page.evaluate(() => localStorage.getItem('livesaver:fix-in-browser'))).toBe(
          null,
        )
      },
      60_000 * PATIENCE,
    )

    test('the page reported no errors, and asked nothing outside its own address', () => {
      expect(watched.problems).toEqual([])
      expect(watched.outside).toEqual([])
    })
  })
}

/** The projects as the repository has them (a test's copy is fixed by the command line). */
function fixturesProjects(): string {
  return join(REPO, 'fixtures', 'projects')
}
