/**
 * A fix in the page in a folder of the disk, with the browser's real rules: Chromium shows a
 * page no file or folder with certain names behind the handle of a folder (a space at the start
 * of a name, say), and makes none. A sample of such a name that lies where its set expects it
 * must not be taken for missing and "found" elsewhere, or the fix fails for every set it
 * touches. The folder is a temporary one; what the page did is read from the disk.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { liveCrc, REL_PROJECT } from '@livesaver/core'
import {
  copyFixtures,
  deviceSet,
  makeProject,
  readSet,
  tempDir,
  writeFile,
  writeSet,
} from '@livesaver/test-kit'
import type { BrowserContext, Page } from 'playwright'
import { build } from '../build.js'
import { serve } from '../serve.js'
import { allowedToEdit, chooseInDialog, startAnew } from './disk.js'
import { filesIn } from './handed.js'
import {
  barriers,
  closeWith,
  dropFolder,
  eventually,
  PATIENCE,
  textOf,
  type Watched,
  watchIn,
} from './support.js'

let site: { url: string; stop: () => void }
beforeAll(async () => {
  await build()
  site = serve()
}, 120_000 * PATIENCE)
afterAll(() => site?.stop())

const SET = 'Brokenpath Project/Brokenpath.als'
const COPY = 'Brokenpath Project/Samples/Imported/1.wav'
/** Names a handle hides: they start with a space. */
const LEAD = ' lead.wav'
const ODD = ' odd.wav'

const bytes = (text: string) => new TextEncoder().encode(text)
/** A set with one sample: in its project (`relPath`), or on a drive that is gone. */
const sampleSet = (path: string, data: Uint8Array, relPath = '') =>
  deviceSet(
    path,
    data.length,
    liveCrc(data),
    relPath ? { relType: REL_PROJECT, relPath } : { relPath: `../../..${path}` },
  ).replaceAll('MxPatchRef', 'SampleRef')

describe('a fix in a folder of the disk (Chromium, allowed to edit files for the site)', () => {
  let context: BrowserContext
  let watched: Watched
  let page: Page
  let tmp: { path: string; cleanup: () => void }
  let projects: string
  let samples: string
  /** Every file of the project folder as it was when a test began, by its path. */
  let before: Map<string, Buffer>
  const noted = () =>
    new Map(filesIn(projects).map((path) => [path, readFileSync(join(projects, path))]))

  /**
   * Beside the fixtures' project with a sample to find: a project whose sample lies in it under
   * a name the browser hides, and one that looks for a sample of such a name on a drive that is
   * gone. Both samples also lie in the sample folder.
   */
  beforeAll(async () => {
    tmp = tempDir()
    ;({ projects, samples } = copyFixtures(tmp.path))
    const lead = bytes('RIFF lead of the song')
    const song = makeProject(projects, 'Song')
    writeFile(join(song, 'Samples', LEAD), lead)
    writeSet(join(song, 'Song.als'), sampleSet(`${song}/Samples/${LEAD}`, lead, `Samples/${LEAD}`))
    const gone = bytes('RIFF of a drive that is gone')
    const other = makeProject(projects, 'Other')
    writeSet(join(other, 'Other.als'), sampleSet(`/Volumes/Gone/Loops/${ODD}`, gone))
    writeFile(join(samples, 'Loops', LEAD), lead)
    writeFile(join(samples, 'Loops', ODD), gone)

    context = await allowedToEdit(join(tmp.path, 'profile'), site.url)
    watched = await watchIn(context, site.url)
    page = watched.page
    await page.addInitScript(() => localStorage.setItem('livesaver:fix-in-browser', 'on'))
    await page.goto(site.url)
    await page.getByTestId('search-folders').waitFor()
  }, 120_000 * PATIENCE)
  afterAll(async () => {
    await context?.close()
    tmp?.cleanup()
  })

  const projectRow = () => page.getByTestId('projects-folders').getByTestId('folder-row').first()
  const onDisk = (path: string) => readFileSync(join(projects, path))
  /** What the project folder holds that it did not before, without the backups. */
  const added = () =>
    filesIn(projects)
      .filter((path) => !before.has(path) && !path.includes('/Backup/'))
      .sort()
  const changed = () =>
    [...before].filter(([path, data]) => !onDisk(path).equals(data)).map(([path]) => path)

  /** The page may edit the folder once the browser said so: here it does, by its setting. */
  async function allowEditing(): Promise<void> {
    const access = projectRow().getByTestId('folder-access')
    const may = access.getByText('This page may edit it: it can be fixed here.')
    const ask = access.getByRole('button', { name: 'Allow editing' })
    await may.or(ask).first().waitFor()
    // (With its setting in place, the browser may have said yes before it is asked.)
    if (!(await may.count())) await ask.click({ timeout: 3000 }).catch(() => {})
    await may.waitFor()
  }
  async function scan(): Promise<string> {
    await page.getByTestId('scan-library').click()
    await page.locator('#headline').waitFor({ timeout: 30_000 * PATIENCE })
    return page.locator('#headline').innerText()
  }
  /** Reviews and fixes everything; what the page says it did. */
  async function fix(): Promise<string> {
    await page.getByTestId('review').click()
    const dialog = page.getByRole('dialog')
    await dialog.getByTestId('review-continue').click()
    await dialog.getByRole('checkbox', { name: 'Ableton Live is closed' }).check()
    await dialog.getByTestId('review-apply').click()
    await dialog.getByTestId('review-done').waitFor({ timeout: 60_000 * PATIENCE })
    const said = await textOf(dialog.getByTestId('review-fix'))
    await closeWith(dialog, dialog.getByTestId('review-done'))
    await page
      .getByTestId('fix-card')
      .getByText('Nothing to fix')
      .waitFor({ timeout: 30_000 * PATIENCE })
    return said
  }

  test(
    'dropped to be edited, the folder is read in full: the hidden sample is where it is, and the fix writes to the disk',
    async () => {
      before = noted()
      await dropFolder(page, page.getByTestId('projects-folders'), projects)
      await allowEditing()
      // A drop lists every file; the handle that came with it hides one of them.
      expect(await textOf(projectRow().getByTestId('folder-hidden'))).toBe(
        'Dropped, so this page also sees its 1 file with a name a browser hides in a folder it lets a page edit.',
      )
      await dropFolder(page, page.getByTestId('search-folders'), samples)
      await page.getByTestId('search-folders').getByTestId('folder-row').first().waitFor()

      // The song is complete, as it is on the disk: nothing is planned for it.
      expect(await scan()).toBe('3 of 5 sets are complete')
      expect(await page.getByTestId('hidden-names').count()).toBe(0)
      expect(await textOf(page.getByTestId('fix-card'))).toContain('1 set in 1 project')
      // The other sample was found, and the browser makes no file of its name: said, not tried.
      expect(await textOf(page.getByTestId('missing-card'))).toContain(
        'Names the browser does not make 1 Browser limit. They were found, and would be copied into their projects.',
      )
      expect(await barriers(page)).toEqual([])

      expect(await fix()).toContain('Fixed: 1 set rewritten, 1 file copied')
      const fixed = page.getByTestId('fixed')
      expect(await textOf(fixed)).toContain('Fixed: 1 set rewritten, 1 file copied')
      expect(await textOf(fixed)).not.toContain('Not written')

      // On the disk: the set, its copy and its backup; and nothing else was touched.
      expect(readSet(join(projects, SET))).toContain('Samples/Imported')
      expect(added()).toEqual([COPY, `${COPY}.asd`])
      expect(changed()).toEqual([SET])
      expect(readdirSync(join(projects, 'Brokenpath Project', 'Backup'))).toHaveLength(1)

      // The undo puts the set back as it was, and takes the copy out.
      await fixed.getByRole('button', { name: 'Undo this fix' }).click()
      await page.getByTestId('undone').waitFor({ timeout: 30_000 * PATIENCE })
      expect(await textOf(page.getByTestId('undone'))).toContain('Undone: 1 set restored')
      expect(changed()).toEqual([])
      expect(existsSync(join(projects, COPY))).toBe(false)
      expect(watched.problems).toEqual([])
      expect(watched.outside).toEqual([])
    },
    120_000 * PATIENCE,
  )

  test(
    'chosen with the dialog, the hidden sample is left alone and said to be; the folder dropped as well shows it',
    async () => {
      // (The project folder is as it was, but for what the undo took out of it.)
      before = noted()
      await startAnew(page)
      await chooseInDialog(page, projects)
      await allowEditing()
      expect(await projectRow().getByTestId('folder-hidden').count()).toBe(0)
      await dropFolder(page, page.getByTestId('search-folders'), samples)
      await page.getByTestId('search-folders').getByTestId('folder-row').first().waitFor()

      // The page cannot see the song's sample. It is not taken for missing and found elsewhere:
      // the set is left alone, and the page says what it cannot see and what helps.
      expect(await scan()).toBe('2 of 5 sets are complete')
      const notice = page.getByTestId('hidden-names')
      expect(await textOf(notice)).toContain(
        '1 sample may only look missing: your browser does not show it to this page',
      )
      expect(await textOf(notice)).toContain(`For example “Samples/${LEAD}”.`)
      expect(await textOf(notice)).toContain(
        'To let the page see every name, drop your project folder onto the sample folders as well, and scan again.',
      )
      expect(await textOf(page.getByTestId('fix-card'))).toContain('1 set in 1 project')
      expect(await barriers(page)).toEqual([])

      // The fix writes the one set it can, and fails for none.
      expect(await fix()).toContain('Fixed: 1 set rewritten, 1 file copied')
      expect(await textOf(page.getByTestId('fixed'))).not.toContain('Not written')
      expect(added()).toEqual([COPY, `${COPY}.asd`])
      expect(changed()).toEqual([SET])

      // What the notice says: the same folder, dropped onto the sample folders.
      await page.getByRole('link', { name: 'Settings', exact: true }).click()
      await dropFolder(page, page.getByTestId('search-folders'), projects)
      await page.getByTestId('search-folders').getByTestId('folder-row').nth(1).waitFor()
      await page.getByTestId('scan').click()
      const headline = '4 of 5 sets are complete'
      await page.getByRole('link', { name: 'Overview', exact: true }).click()
      expect(await eventually(() => page.locator('#headline').innerText(), headline)).toBe(headline)
      expect(await page.getByTestId('hidden-names').count()).toBe(0)
      expect(watched.problems).toEqual([])
      expect(watched.outside).toEqual([])
    },
    120_000 * PATIENCE,
  )
})
