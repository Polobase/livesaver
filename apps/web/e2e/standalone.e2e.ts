/**
 * The app on its own, as any static host serves it, in the three browser engines: folders are
 * given through the folder upload and by drops, the scan runs in the page's workers, and the
 * result is read from the page. It only reads: nothing here can fix.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { copyFixtures, tempDir, writeFile } from '@livesaver/test-kit'
import type { Browser, Locator, Page } from 'playwright'
import { build } from '../build.js'
import { serve } from '../serve.js'
import { barriers, ENGINES, textOf, textsOf, watch } from './support.js'

let server: { url: string; stop: () => void }

beforeAll(async () => {
  await build()
  server = serve()
}, 120_000)
afterAll(() => server?.stop())

for (const [name, type] of ENGINES) {
  describe(`the app on its own in ${name}`, () => {
    let browser: Browser
    let page: Page
    let tmp: { path: string; cleanup: () => void }
    let problems: string[]
    let outside: string[]

    beforeAll(async () => {
      tmp = tempDir()
      copyFixtures(tmp.path)
      browser = await type.launch(
        // Chrome can hand out a dropped folder as a handle, which hides files with certain
        // names. Switched on, the drop test proves that the page does not use it.
        name === 'Chromium' ? { args: ['--enable-features=FileSystemAccessAPI'] } : {},
      )
      ;({ page, problems, outside } = await watch(browser, server.url))
      await page.goto(server.url)
      await page.getByTestId('search-folders').waitFor()
    }, 60_000)
    afterAll(async () => {
      await browser?.close()
      tmp?.cleanup()
    })

    const texts = (testId: string) => page.getByTestId(testId).allInnerTexts()
    const scanned = () => page.getByTestId('fix-card').waitFor({ timeout: 30_000 })
    const goTo = async (place: string) => {
      // A panel left open by a test that failed must not stand in the way of the next.
      if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape')
      await page.getByRole('link', { name: place, exact: true }).click()
      await page.getByRole('heading', { level: 1, name: place, exact: true }).waitFor()
    }
    /** What the page still wants among the sample folders (the start of each hint). */
    const wanted = async () =>
      (await page.getByTestId('wanted').locator('li').allInnerTexts()).map(
        (text) => text.split(':')[0],
      )
    const rows = () => page.locator('table tbody tr[data-slot=tr]')

    /** Drops a folder from disk on an element, as a drag from the file manager does. */
    const drop = async (target: Locator, folder: string) => {
      await target.scrollIntoViewIfNeeded()
      const box = await target.boundingBox()
      if (!box) throw new Error('nothing to drop on')
      const at = { x: box.x + box.width / 2, y: box.y + 16 }
      const data = { items: [], files: [folder], dragOperationsMask: 1 }
      const session = await page.context().newCDPSession(page)
      for (const kind of ['dragEnter', 'dragOver', 'drop'] as const)
        await session.send('Input.dispatchDragEvent', { type: kind, ...at, data })
      await session.detach()
    }
    /** Only Chromium lets a test drop a folder (through its debugging protocol). */
    const withDrops = name === 'Chromium' ? test : test.skip

    test('there is nothing to scan without a project folder', async () => {
      expect(await page.getByTestId('scan-library').isDisabled()).toBe(true)
      expect(await page.getByTestId('scan').isDisabled()).toBe(true)
      expect(await page.getByTestId('needs-project').innerText()).toBe(
        'Add a project folder to start.',
      )
      expect(await wanted()).toEqual(['your User Library and Factory Packs', "Live's own content"])
      expect(await page.getByTestId('where').innerText()).toBe('In this browser')
    }, 30_000)

    test('uploaded folders are scanned, and the overview says what was found', async () => {
      await page.getByTestId('projects-input').setInputFiles(join(tmp.path, 'projects'))
      await page.getByTestId('search-input').setInputFiles(join(tmp.path, 'samples'))
      expect(await texts('folder-name')).toEqual(['projects', 'samples'])
      expect(await texts('folder-facts')).toEqual(['7 files', '3 files'])
      await page.getByTestId('scan-library').click()
      await scanned()

      expect(await page.locator('#headline').innerText()).toBe('2 of 3 sets are complete')
      expect(await page.getByTestId('headline-rest').innerText()).toBe(
        '1 more will be after a fix.',
      )
      expect(await page.getByTestId('fixable').innerText()).toBe('1 set in 1 project')
      expect(await page.getByTestId('missing-card').innerText()).toContain('Nothing')
      expect(await page.getByTestId('found-sources').innerText()).toContain('samples/Lib1')
      expect(await page.locator('[data-status=found]').innerText()).toBe('1')
      expect(await page.getByTestId('no-live-content').innerText()).toContain(
        "Live's own content was not among the folders",
      )
      // The page says why it has no button to fix, instead of having none without a word.
      expect(await page.getByTestId('no-fix').innerText()).toContain('This page only reads.')
      expect(await page.getByTestId('facts').innerText()).toContain(
        'Scanned 3 sets against 3 audio files and Max devices',
      )
      expect(await page.getByTestId('facts').innerText()).toContain('in this browser')
    }, 60_000)

    test('the sets say where the project folder lies; the sample folder stays unplaced', async () => {
      await goTo('Settings')
      const places = page.getByTestId('folder-place')
      expect([await textOf(places.first()), await textOf(places.last())]).toEqual([
        '/Users/someone/livesaver/fixtures/projects (found from your sets) Change path',
        'Set path',
      ])
    }, 30_000)

    test('the tabs list the planned change, and filters narrow the rows', async () => {
      await goTo('Samples')
      await page.getByRole('tab', { name: /Changes/ }).click()
      await rows().first().waitFor()
      expect(await textsOf(rows().first().locator('td'))).toEqual([
        'Repair',
        '1.wav',
        'Brokenpath Project/Brokenpath.als',
        'Samples/Imported',
        'Confirmed',
      ])
      await page.getByRole('tab', { name: /Sets/ }).click()
      await rows().first().waitFor()
      expect(await rows().count()).toBe(3)
      await page.getByLabel('Filter sets').click()
      await page.getByRole('option', { name: 'Can be fixed' }).click()
      expect(await page.getByTestId('shown').innerText()).toBe('1 of 3')
      expect(await rows().count()).toBe(1)
      await page.getByLabel('Search sets').fill('nothing like this')
      await page.getByText('Nothing matches.').waitFor()
      expect(await page.getByTestId('shown').innerText()).toBe('0 of 3')
    }, 30_000)

    test('a project opens from the side with what a fix changes in it', async () => {
      await page.getByRole('tab', { name: /Projects/ }).click()
      await page.getByText('Brokenpath Project', { exact: true }).click()
      const panel = page.getByRole('dialog')
      await panel.getByText('What a fix changes (1)').waitFor()
      expect(await panel.getByRole('heading', { level: 2 }).innerText()).toBe('Brokenpath Project')
      // A path keeps its end when there is no room; the whole of it is its title.
      await panel.getByTitle('Samples/Imported/1.wav').waitFor()
      expect(await textOf(panel)).toContain('Found by: fingerprint ok')
      // Nothing can be fixed here, so the panel offers no fix.
      expect(await panel.getByRole('button', { name: 'Fix this project' }).count()).toBe(0)
      await page.keyboard.press('Escape')
      await panel.waitFor({ state: 'hidden' })
    }, 30_000)

    test('a report downloads as the command line writes it', async () => {
      await goTo('Overview')
      await page.getByTestId('reports').click()
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('menuitem', { name: /Planned changes/ }).click(),
      ])
      expect(download.suggestedFilename()).toBe('changes.csv')
      const bytes = new Uint8Array(await Bun.file(await download.path()).arrayBuffer())
      expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]) // the mark Excel needs
      expect(new TextDecoder().decode(bytes).split('\r\n')[0]).toBe(
        'Project,Set,Action,Sample,Old path,New path (in project),Copied from,Method,Confidence',
      )
    }, 30_000)

    test('without the sample folder the sample is missing, with what to do about it', async () => {
      await goTo('Settings')
      await page.getByRole('button', { name: 'Remove samples' }).click()
      await page.getByRole('button', { name: 'Remove projects' }).click()
      await page
        .getByTestId('projects-input')
        .setInputFiles(join(tmp.path, 'projects', 'Brokenpath Project'))
      await page.getByTestId('scan').click()
      await goTo('Overview')
      await page.getByTestId('missing').waitFor({ timeout: 30_000 })
      expect(await page.locator('#headline').innerText()).toBe('0 of 1 set is complete')
      expect(await page.getByTestId('missing').innerText()).toBe('1 sample from 1 source')
      expect(await page.getByTestId('missing-card').innerText()).toContain(
        'Find this folder or drive and add it as a sample folder.',
      )
      await page.getByRole('link', { name: 'See all missing samples' }).click()
      await page.getByTestId('missing-groups').waitFor()
      await page.getByTestId('missing-groups').getByRole('button', { expanded: false }).click()
      await page.getByRole('cell', { name: '1.wav' }).click()
      const panel = page.getByRole('dialog')
      await panel.getByText('No file of this name is in the folders that were searched.').waitFor()
      expect(await panel.innerText()).toContain('Brokenpath.als')
      await page.keyboard.press('Escape')
      await panel.waitFor({ state: 'hidden' })
    }, 60_000)

    test('the button opens the folder upload, and says that a large folder takes a while', async () => {
      await goTo('Settings')
      const hint = page.getByTestId('folder-waiting').last()
      const chooser = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: 'Add folder' }).last().click()
      expect(await hint.innerText()).toBe('a large folder takes a few seconds to appear…')
      await (await chooser).setFiles(join(tmp.path, 'samples'))
      await page.getByTestId('folder-name').getByText('samples').waitFor()
      expect(await hint.innerText()).toBe('or drop a folder here')
    }, 30_000)

    withDrops(
      'dropped folders are listed entry by entry, with names a folder handle would hide',
      async () => {
        const remove = page.getByRole('button', { name: /^Remove / })
        while (await remove.count()) await remove.first().click()
        // A ':' in a name (Finder shows it as '/') and a leading space: Chromium's handles
        // skip both.
        writeFile(join(tmp.path, 'samples', 'Claps:Snares', ' clap.wav'), 'RIFF')
        const filesIn = (folder: string) =>
          readdirSync(join(tmp.path, folder), { recursive: true, withFileTypes: true }).filter(
            (entry) => entry.isFile(),
          ).length
        expect(
          await page.evaluate(() => 'getAsFileSystemHandle' in DataTransferItem.prototype),
        ).toBe(true)

        // Beside the lists a drop is swallowed: a browser would otherwise leave the page for it.
        const swallowed = await page.evaluate(() =>
          ['dragover', 'drop'].map((kind) => {
            const event = new DragEvent(kind, { bubbles: true, cancelable: true })
            document.querySelector('h1')?.dispatchEvent(event)
            return event.defaultPrevented
          }),
        )
        expect(swallowed).toEqual([true, true])

        await drop(page.getByTestId('projects-folders'), join(tmp.path, 'projects'))
        await page.getByTestId('folder-name').getByText('projects').waitFor()
        await drop(page.getByTestId('search-folders'), join(tmp.path, 'samples'))
        await page.getByTestId('folder-name').getByText('samples').waitFor()
        expect(await texts('folder-facts')).toEqual([
          `${filesIn('projects')} files`,
          `${filesIn('samples')} files`,
        ])

        await page.getByTestId('scan').click()
        await goTo('Overview')
        await page.getByTestId('fixable').waitFor({ timeout: 30_000 })
        expect(await page.locator('#headline').innerText()).toBe('2 of 3 sets are complete')
        expect(await page.getByTestId('facts').innerText()).toContain('against 4 audio files')
      },
      60_000,
    )

    test('the library option says when no folder is marked as holding installed libraries', async () => {
      await goTo('Settings')
      const option = page.getByRole('switch', { name: /Also accept a library file/ })
      const note = page.getByTestId('option-note')
      expect(await note.count()).toBe(0)
      await option.click()
      expect(await note.innerText()).toContain('None of your sample folders is marked')
      // A folder called like the place of Native Instruments' libraries is marked when added.
      writeFile(join(tmp.path, 'Shared', 'Some Library', 'Samples', 'x.wav'), 'RIFF')
      await page.getByTestId('search-input').setInputFiles(join(tmp.path, 'Shared'))
      const marked = page
        .getByTestId('folder-row')
        .filter({ hasText: 'Shared' })
        .getByRole('checkbox', { name: 'Contains installed libraries' })
      await marked.waitFor()
      expect(await marked.isChecked()).toBe(true)
      expect(await note.count()).toBe(0)
      await marked.click()
      expect(await note.count()).toBe(1)
      await marked.click()
      await option.click()
      expect(await option.isChecked()).toBe(false)
    }, 30_000)

    withDrops(
      'the Live app can be dropped as a folder, and the page says what it still wants',
      async () => {
        const app = join(tmp.path, 'Ableton Live 12 Suite.app')
        writeFile(
          join(app, 'Contents', 'App-Resources', 'Core Library', 'Samples', 'x.wav'),
          'RIFF',
        )
        writeFile(join(app, 'Contents', 'Info.plist'), '<plist/>')
        await drop(page.getByTestId('search-folders'), app)
        const row = page.getByTestId('folder-row').filter({ hasText: 'Ableton Live 12 Suite.app' })
        await row.waitFor()
        expect(await row.getByTestId('folder-facts').innerText()).toBe(
          "2 files · Live's own content",
        )
        expect(await wanted()).toEqual(['your User Library and Factory Packs'])
        // Live's own content always counts as installed: no box to tick on its row.
        expect(await row.getByRole('checkbox').count()).toBe(0)
        writeFile(join(tmp.path, 'Ableton', 'User Library', 'Samples', 'u.wav'), 'RIFF')
        await page.getByTestId('search-input').setInputFiles(join(tmp.path, 'Ableton'))
        await page.getByTestId('folder-name').getByText('Ableton', { exact: true }).waitFor()
        expect(await page.getByTestId('wanted').count()).toBe(0)

        await page.getByTestId('scan').click()
        await goTo('Overview')
        await page
          .getByTestId('facts')
          .getByText('Recognised: User Library, Core Library.')
          .waitFor({
            timeout: 30_000,
          })
        expect(await page.getByTestId('no-live-content').count()).toBe(0)
      },
      60_000,
    )

    for (const scheme of ['light', 'dark'] as const) {
      test(`the screens have no barrier in ${scheme}`, async () => {
        await page.emulateMedia({ colorScheme: scheme })
        for (const place of ['Overview', 'Samples', 'History', 'Settings']) {
          await goTo(place)
          expect([place, await barriers(page)]).toEqual([place, []])
        }
        for (const tab of ['Missing', 'Changes', 'Sets']) {
          await goTo('Samples')
          await page.getByRole('tab', { name: new RegExp(tab) }).click()
          expect([tab, await barriers(page)]).toEqual([tab, []])
        }
      }, 60_000)
    }

    test('what only livesaver can do is explained, or not offered', async () => {
      await goTo('History')
      expect(await textOf(page.getByTestId('no-history'))).toContain('There is no history here')
      // What needs livesaver says how to get it: a link to the guide, in a tab of its own.
      const guide = page
        .getByTestId('no-history')
        .getByRole('link', { name: 'How to get livesaver' })
      expect([await guide.getAttribute('href'), await guide.getAttribute('target')]).toEqual([
        'https://polobase.github.io/livesaver/docs/guide/getting-started/#install-livesaver-on-your-mac',
        '_blank',
      ])
      expect(await page.getByTestId('all-runs').count()).toBe(0)
      await goTo('Settings')
      // No settings of its own to go back to, and nothing of this computer it could have found.
      expect(await page.getByTestId('reset-settings').count()).toBe(0)
      expect(await page.getByTestId('found').count()).toBe(0)
      expect(await page.getByRole('button', { name: /^Show in Finder/ }).count()).toBe(0)
      expect(await textOf(page.locator('#about-title + dl'))).toContain(
        'in this browser, on its own',
      )
      await goTo('Overview')
      expect(await page.getByTestId('recent-runs').count()).toBe(0)
    }, 30_000)

    test('coming back to the page shows its own state, not what the browser remembered', async () => {
      // A browser restores form controls by their order: an option could get the tick of a
      // folder's box, while the page itself starts with the option off.
      await goTo('Settings')
      await page.getByRole('switch', { name: /Also accept a library file/ }).click()
      await page.goto('about:blank')
      await page.goBack()
      await page.getByTestId('search-folders').waitFor()
      expect(await page.getByTestId('folder-row').count()).toBe(0)
      const option = page.getByRole('switch', { name: /Also accept a library file/ })
      expect(await option.isChecked()).toBe(false)
    }, 30_000)

    test('the page reported no errors, and asked nothing outside its own address', () => {
      expect(problems).toEqual([])
      expect(outside).toEqual([])
    })
  })
}
