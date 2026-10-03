/**
 * The built page in a real browser: folders are given through the folder upload and by drops,
 * the check runs in the workers, and the result is read from the page.
 *
 * Needs a Chromium-based browser; set LIVESAVER_BROWSER to its executable if it is not found.
 * Usage: bun run test:e2e
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { copyFixtures, tempDir, writeFile } from '@livesaver/test-kit'
import { type Browser, chromium, type Locator, type Page } from 'playwright-core'
import { build } from '../build.js'
import { serve } from '../serve.js'

const BROWSERS = [
  process.env.LIVESAVER_BROWSER ?? '',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]
const executable = BROWSERS.find((path) => path && existsSync(path))
// On CI the step must not pass by testing nothing.
if (!executable && process.env.CI)
  throw new Error('No Chromium-based browser found: set LIVESAVER_BROWSER to its executable')

;(executable ? describe : describe.skip)('the page in a browser', () => {
  let browser: Browser
  let page: Page
  let server: { url: string; stop: () => void }
  let tmp: { path: string; cleanup: () => void }
  const problems: string[] = []

  beforeAll(async () => {
    await build()
    server = serve()
    tmp = tempDir()
    copyFixtures(tmp.path)
    browser = await chromium.launch({
      executablePath: executable as string,
      headless: true,
      // Chrome can hand out a dropped folder as a handle, which hides files with certain names;
      // Brave ships that API switched off. Switched on, the drop test proves it is not used.
      args: ['--enable-features=FileSystemAccessAPI'],
    })
    page = await browser.newPage()
    page.on('pageerror', (error) => problems.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(message.text())
    })
    await page.goto(server.url)
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    server?.stop()
    tmp?.cleanup()
  })

  const tile = (label: string) =>
    page.locator('.tile', { hasText: label }).locator('.tile-value').innerText()

  /** Drops a folder from disk on an element, as a drag from the file manager does. */
  const drop = async (target: Locator, folder: string) => {
    await target.scrollIntoViewIfNeeded()
    const box = await target.boundingBox()
    if (!box) throw new Error('nothing to drop on')
    const at = { x: box.x + box.width / 2, y: box.y + 16 }
    const data = { items: [], files: [folder], dragOperationsMask: 1 }
    const session = await page.context().newCDPSession(page)
    for (const type of ['dragEnter', 'dragOver', 'drop'] as const)
      await session.send('Input.dispatchDragEvent', { type, ...at, data })
    await session.detach()
  }

  test('nothing to check without a project folder', async () => {
    expect(await page.getByRole('button', { name: 'Check sets' }).isDisabled()).toBe(true)
  })

  test('uploaded folders are checked and the result is shown', async () => {
    await page.getByTestId('projects-input').setInputFiles(join(tmp.path, 'projects'))
    await page.getByTestId('search-input').setInputFiles(join(tmp.path, 'samples'))
    expect(await page.locator('.folder-name').allInnerTexts()).toEqual(['projects', 'samples'])
    await page.getByRole('button', { name: 'Check sets' }).click()
    await page.locator('.tiles').waitFor({ timeout: 30_000 })

    expect(await tile('Sets complete')).toBe('3')
    expect(await tile('Missing samples')).toBe('0')
    expect(await tile('References to repair')).toBe('1')
    expect(await tile('Files to copy')).toBe('1')
    // The sets say where the project folder was saved; the sample folder stays unplaced.
    expect(await page.locator('.folder-place').allInnerTexts()).toEqual([
      '/Users/someone/livesaver/fixtures/projects (found from your sets) Change path',
      'Set path',
    ])
    expect(await page.locator('.bars').last().locator('.bar-name').allInnerTexts()).toEqual([
      'samples/Lib1',
    ])
    expect(await page.locator('table.data tbody tr').count()).toBe(3)
  }, 60_000)

  test('the tabs list the planned change, and filters narrow the rows', async () => {
    await page.getByRole('tab', { name: /Planned changes/ }).click()
    const cells = await page.locator('table.data tbody tr').first().locator('td').allInnerTexts()
    expect(cells.slice(0, 4)).toEqual(['Brokenpath Project', 'Brokenpath.als', 'Repair', '1.wav'])
    expect(cells.at(-1)).toBe('certain')
    await page.getByRole('tab', { name: /Sets/ }).click()
    await page.getByLabel('Filter sets').selectOption({ label: 'Can be fixed' })
    expect(await page.locator('table.data tbody tr').count()).toBe(1)
    await page.getByLabel('Search sets').fill('nothing like this')
    expect(await page.locator('table.data tbody tr').count()).toBe(0)
  })

  test('a report downloads as the command line writes it', async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page
        .getByRole('button', { name: /Planned changes/ })
        .last()
        .click(),
    ])
    expect(download.suggestedFilename()).toBe('changes.csv')
    const bytes = new Uint8Array(await Bun.file(await download.path()).arrayBuffer())
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]) // the mark Excel needs for UTF-8
    expect(new TextDecoder().decode(bytes).split('\r\n')[0]).toBe(
      'Project,Set,Action,Sample,Old path,New path (in project),Copied from,Method,Confidence',
    )
  })

  test('without the sample folder the sample is reported missing', async () => {
    await page.getByRole('button', { name: 'Remove samples' }).click()
    await page.getByRole('button', { name: 'Remove projects' }).click()
    await page
      .getByTestId('projects-input')
      .setInputFiles(join(tmp.path, 'projects', 'Brokenpath Project'))
    await page.getByRole('button', { name: 'Check sets' }).click()
    await page.locator('.tiles').waitFor({ timeout: 30_000 })
    expect(await tile('Sets complete')).toBe('0')
    expect(await tile('Missing samples')).toBe('1')
    expect(await page.locator('.bars').first().locator('.bar-hint').innerText()).toBe(
      'Find the folder or drive and add it as a sample folder',
    )
  }, 60_000)

  test('the button opens the folder upload, and says that a large folder takes a while', async () => {
    const hint = page.locator('.folder-add .hint').last()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Add folder' }).last().click()
    expect(await hint.innerText()).toBe('a large folder takes a few seconds to appear…')
    await (await chooser).setFiles(join(tmp.path, 'samples'))
    await page.locator('.folder-name', { hasText: 'samples' }).waitFor()
    expect(await hint.innerText()).toBe('or drop a folder here')
  })

  test('dropped folders are listed entry by entry, with names a folder handle would hide', async () => {
    const remove = page.getByRole('button', { name: /^Remove / })
    while (await remove.count()) await remove.first().click()
    // A ':' in a name (Finder shows it as '/') and a leading space: Chromium's handles skip both.
    writeFile(join(tmp.path, 'samples', 'Claps:Snares', ' clap.wav'), 'RIFF')
    const filesIn = (folder: string) =>
      readdirSync(join(tmp.path, folder), { recursive: true, withFileTypes: true }).filter((e) =>
        e.isFile(),
      ).length
    expect(await page.evaluate(() => 'getAsFileSystemHandle' in DataTransferItem.prototype)).toBe(
      true,
    )

    // Beside the lists a drop is swallowed: a browser would otherwise leave the page for the folder.
    const swallowed = await page.evaluate(() =>
      ['dragover', 'drop'].map((type) => {
        const event = new DragEvent(type, { bubbles: true, cancelable: true })
        document.querySelector('h1')?.dispatchEvent(event)
        return event.defaultPrevented
      }),
    )
    expect(swallowed).toEqual([true, true])

    await drop(page.locator('.folders').first(), join(tmp.path, 'projects'))
    await page.locator('.folder-name', { hasText: 'projects' }).waitFor()
    await drop(page.locator('.folders').last(), join(tmp.path, 'samples'))
    await page.locator('.folder-name', { hasText: 'samples' }).waitFor()
    expect(await page.locator('.folder-main > div:first-child').allInnerTexts()).toEqual([
      `projects ${filesIn('projects')} files`,
      `samples ${filesIn('samples')} files`,
    ])

    await page.getByRole('button', { name: 'Check sets' }).click()
    await page.locator('.tiles').waitFor({ timeout: 30_000 })
    expect(await tile('Sets complete')).toBe('3')
    expect(await tile('References to repair')).toBe('1')
    expect(await tile('Files to copy')).toBe('1')
    expect(await page.locator('.facts').innerText()).toContain('against 4 audio files')
  }, 60_000)

  test('the page reported no errors', () => {
    expect(problems).toEqual([])
  })
})
