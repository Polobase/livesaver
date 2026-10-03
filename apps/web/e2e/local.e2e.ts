/**
 * The page with livesaver on this computer behind it, in a real browser: folders are chosen by
 * path, the check runs on the computer, and a fix (of one project, of all) and its undo really
 * write, to copies of the fixtures in a temporary folder.
 *
 * Needs a Chromium-based browser; set LIVESAVER_BROWSER to its executable if it is not found.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { copyFixtures, readSet, tempDir } from '@livesaver/test-kit'
import { startWeb, type WebServer } from 'livesaver'
import { type Browser, chromium, type Page } from 'playwright-core'
import { build, DIST } from '../build.js'

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

;(executable ? describe : describe.skip)('the page with livesaver on this computer', () => {
  let browser: Browser
  let page: Page
  let server: WebServer
  let tmp: { path: string; cleanup: () => void }
  let projects: string
  let samples: string
  const problems: string[] = []
  const saved = { home: process.env.LIVESAVER_HOME, trash: process.env.LIVESAVER_TRASH_DIR }

  beforeAll(async () => {
    await build()
    tmp = tempDir()
    ;({ projects, samples } = copyFixtures(tmp.path))
    // A second project with the same broken set: one is fixed alone, then all.
    cpSync(join(projects, 'Brokenpath Project'), join(projects, 'Other Project'), {
      recursive: true,
    })
    // livesaver's own state and the Trash of an undo lie in the temporary folder as well.
    process.env.LIVESAVER_HOME = join(tmp.path, 'home')
    process.env.LIVESAVER_TRASH_DIR = join(tmp.path, 'trash')
    const config = join(tmp.path, 'config.json')
    writeFileSync(
      config,
      JSON.stringify({ appResources: '', vendorLibraries: [], searchRoots: [samples] }),
    )
    server = await startWeb({ assets: DIST, config, force: true })
    browser = await chromium.launch({ executablePath: executable as string, headless: true })
    page = await browser.newPage()
    page.on('pageerror', (error) => problems.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(message.text())
    })
    await page.goto(server.url)
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
    tmp?.cleanup()
    for (const [key, value] of [
      ['LIVESAVER_HOME', saved.home],
      ['LIVESAVER_TRASH_DIR', saved.trash],
    ] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  const tile = (label: string) =>
    page.locator('.tile', { hasText: label }).locator('.tile-value').innerText()
  const setOf = (project: string) => join(projects, project, 'Brokenpath.als')
  const fixedOnDisk = (project: string) => readSet(setOf(project)).includes('Samples/Imported')
  const checked = () => page.locator('.tiles').waitFor({ timeout: 30_000 })
  /** The projects that have a button to fix them alone. */
  const fixButtons = () =>
    page
      .locator('table.data button')
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')))

  test('it starts with the sample folders of this computer, and wants a project folder', async () => {
    await page.locator('.folder-row').first().waitFor()
    expect(await page.locator('.folder-name').allInnerTexts()).toEqual(['samples'])
    expect(await page.locator('.folder-place').allInnerTexts()).toEqual([samples])
    expect(await page.getByRole('button', { name: 'Check sets' }).isDisabled()).toBe(true)
  })

  test('a project folder is chosen in the page, by clicking through folders or by its path', async () => {
    await page.getByRole('button', { name: 'Add folder' }).first().click()
    const dialog = page.getByRole('dialog')
    const path = dialog.getByLabel('Path of the folder')
    await path.fill(tmp.path)
    await path.press('Enter')
    await dialog.getByRole('button', { name: 'projects', exact: true }).click()
    await dialog.getByRole('button', { name: 'Brokenpath Project' }).waitFor()
    expect(await path.inputValue()).toBe(projects)
    expect(await dialog.locator('.browser-item').allInnerTexts()).toEqual([
      '↑\nUp',
      'Brokenpath Project',
      'Fixed Path Project',
      'Other Project',
      'VST2toVST3 Project',
    ])
    await path.fill(join(tmp.path, 'nothing'))
    await path.press('Enter')
    expect(await dialog.getByRole('alert').innerText()).toContain('cannot be opened')
    await path.fill(projects)
    await path.press('Enter')
    await dialog.getByRole('button', { name: 'Add this folder' }).click()
    expect(await page.locator('.folder-name').allInnerTexts()).toEqual(['projects', 'samples'])
  })

  test('the check runs on this computer and lists the projects, each with its fix', async () => {
    await page.getByRole('button', { name: 'Check sets' }).click()
    await checked()
    expect(await tile('Sets complete')).toBe('4')
    expect(await tile('References to repair')).toBe('2')
    expect(await page.locator('.fix-bar h2').innerText()).toBe('2 sets in 2 projects can be fixed')
    const rows = await page.locator('table.data tbody tr').evaluateAll((all) =>
      all.map((row) =>
        [...row.querySelectorAll('td')]
          .slice(0, 2)
          .map((cell) => cell.textContent?.trim())
          .join(': '),
      ),
    )
    expect(rows).toEqual([
      'Brokenpath Project: Can be fixed',
      'Fixed Path Project: Complete',
      'Other Project: Can be fixed',
      'VST2toVST3 Project: Complete',
    ])
    expect(await fixButtons()).toEqual(['Fix Brokenpath Project', 'Fix Other Project'])
    expect(await page.locator('.facts').innerText()).toContain('on this computer')
  }, 60_000)

  test('a fix asks first, and Cancel leaves everything as it is', async () => {
    await page.getByRole('button', { name: 'Fix Other Project' }).click()
    const dialog = page.getByRole('dialog')
    expect(await dialog.locator('h2').innerText()).toBe('Fix "Other Project"?')
    expect(await dialog.locator('li').allInnerTexts()).toEqual([
      '1 set is rewritten. The set as it was is kept in the Backup folder of its project.',
      '1 file (2.0 MB) is copied into the project.',
      'Ableton Live must not be running.',
    ])
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(await page.getByRole('dialog').count()).toBe(0)
    expect([fixedOnDisk('Other Project'), fixedOnDisk('Brokenpath Project')]).toEqual([
      false,
      false,
    ])
  })

  test('one project is fixed alone: its set rewritten, its sample copied, a backup kept', async () => {
    const original = readFileSync(setOf('Other Project'))
    await page.getByRole('button', { name: 'Fix Other Project' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Fix 1 set' }).click()
    await page.locator('.callout', { hasText: 'Fixed' }).waitFor({ timeout: 30_000 })
    await checked()
    expect(await page.locator('.callout', { hasText: 'Fixed' }).locator('p').innerText()).toBe(
      'Fixed "Other Project": 1 set rewritten, 1 file copied (2.0 MB).',
    )
    expect([fixedOnDisk('Other Project'), fixedOnDisk('Brokenpath Project')]).toEqual([true, false])
    expect(existsSync(join(projects, 'Other Project', 'Samples', 'Imported', '1.wav'))).toBe(true)
    const backups = readdirSync(join(projects, 'Other Project', 'Backup'))
    expect(backups).toHaveLength(1)
    expect(
      readFileSync(join(projects, 'Other Project', 'Backup', backups[0] as string)).equals(
        original,
      ),
    ).toBe(true)
    // The page checked again by itself: one project is left to fix.
    expect(await page.locator('.fix-bar h2').innerText()).toBe('1 set in 1 project can be fixed')
    expect(await fixButtons()).toEqual(['Fix Brokenpath Project'])
  }, 60_000)

  test('undo takes the fix back', async () => {
    await page.getByRole('button', { name: 'Undo this fix' }).click()
    await page.locator('.callout', { hasText: 'Undone' }).waitFor({ timeout: 30_000 })
    await checked()
    expect(await page.locator('.callout', { hasText: 'Undone' }).locator('p').innerText()).toBe(
      'Undone: 1 set restored, 2 files moved to the Trash.',
    )
    expect(fixedOnDisk('Other Project')).toBe(false)
    expect(existsSync(join(projects, 'Other Project', 'Samples', 'Imported', '1.wav'))).toBe(false)
    expect(await page.locator('.fix-bar h2').innerText()).toBe('2 sets in 2 projects can be fixed')
  }, 60_000)

  test('Fix all fixes every project, and then nothing is left to fix', async () => {
    await page.getByRole('button', { name: 'Fix all' }).click()
    const dialog = page.getByRole('dialog')
    expect(await dialog.locator('h2').innerText()).toBe('Fix 2 projects?')
    await dialog.getByRole('button', { name: 'Fix 2 sets' }).click()
    await page.locator('.callout', { hasText: 'Fixed' }).waitFor({ timeout: 30_000 })
    await checked()
    expect(await page.locator('.callout', { hasText: 'Fixed' }).locator('p').innerText()).toBe(
      'Fixed all projects: 2 sets rewritten, 2 files copied (4.0 MB).',
    )
    expect([fixedOnDisk('Other Project'), fixedOnDisk('Brokenpath Project')]).toEqual([true, true])
    expect(await page.locator('.fix-bar').count()).toBe(0)
    expect(await tile('References to repair')).toBe('0')
    expect(await fixButtons()).toEqual([])
  }, 60_000)

  test('the next visit starts with the same folders, and can still undo the last fix', async () => {
    await page.reload()
    await page.locator('.folder-row').first().waitFor()
    expect(await page.locator('.folder-name').allInnerTexts()).toEqual(['projects', 'samples'])
    expect(await page.getByRole('button', { name: 'Check sets' }).isEnabled()).toBe(true)
    const last = page.locator('.callout', { hasText: 'The last fix' })
    expect(await last.locator('p').innerText()).toMatch(
      /^The last fix, on \d{4}-\d\d-\d\d \d\d:\d\d, rewrote 2 sets and copied 2 files\.$/,
    )
    await last.getByRole('button', { name: 'Undo this fix' }).click()
    await page.locator('.callout', { hasText: 'Undone' }).waitFor({ timeout: 30_000 })
    await checked()
    expect([fixedOnDisk('Other Project'), fixedOnDisk('Brokenpath Project')]).toEqual([
      false,
      false,
    ])
    // Nothing older is left to undo: the fix of the one project was undone before.
    expect(await page.getByRole('button', { name: /^Undo/ }).count()).toBe(0)
    expect(await page.locator('.fix-bar h2').innerText()).toBe('2 sets in 2 projects can be fixed')
  }, 60_000)

  test('the page reported no errors', () => {
    expect(problems).toEqual([])
  })
})
