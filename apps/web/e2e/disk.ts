/**
 * A folder of the disk that a page may edit, in Chromium itself. A browser asks its user before
 * a page may write into a folder, and no test can press that prompt. But the answer "allow on
 * every visit" is a setting of the browser for the site, kept in its profile: written into a
 * profile before the browser starts with it, the page is let in as it is for that user.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type BrowserContext, chromium, type Page } from 'playwright'
import { dropFolder } from './support.js'

/**
 * Chromium as it is installed for people, not the headless shell the other tests use: only it
 * has the settings of a site. (It runs without a window all the same.)
 */
const BROWSER = { channel: 'chromium' } as const

/** A profile's settings for a site, as the browser keeps them: by a time in its own count. */
const stamp = () => String((Date.now() + 11_644_473_600_000) * 1000)

/**
 * Starts the browser with a profile in which the site may read and edit the files and folders
 * its user hands it. The profile is made by the browser itself first: a setting is only taken
 * from a profile it knows.
 */
export async function allowedToEdit(profile: string, site: string): Promise<BrowserContext> {
  const first = await chromium.launchPersistentContext(profile, BROWSER)
  await (first.pages()[0] ?? (await first.newPage())).goto(site)
  await first.close()
  const file = join(profile, 'Default', 'Preferences')
  const settings = JSON.parse(readFileSync(file, 'utf8'))
  settings.profile ??= {}
  settings.profile.content_settings ??= {}
  settings.profile.content_settings.exceptions ??= {}
  const allowed = { [`${new URL(site).origin},*`]: { last_modified: stamp(), setting: 1 } }
  for (const guard of ['file_system_write_guard', 'file_system_read_guard'])
    settings.profile.content_settings.exceptions[guard] = allowed
  writeFileSync(file, JSON.stringify(settings))
  return chromium.launchPersistentContext(profile, {
    ...BROWSER,
    viewport: { width: 1280, height: 800 },
    timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
}

/**
 * Hands the page a folder of the disk in the place of the folder dialog, which a test cannot
 * drive. The dialog gives a page the handle of the folder and nothing else; a drop gives the
 * same handle, so the test drops the folder, keeps the page's own handler from seeing the drop,
 * and has the "dialog" answer with that handle.
 */
export async function chooseInDialog(page: Page, folder: string): Promise<void> {
  await page.evaluate(() => {
    const picked = new Promise((resolve) => {
      document.addEventListener(
        'drop',
        (event) => {
          event.preventDefault()
          event.stopImmediatePropagation()
          const item = event.dataTransfer?.items[0] as DataTransferItem & {
            getAsFileSystemHandle(): Promise<unknown>
          }
          resolve(item.getAsFileSystemHandle())
        },
        { capture: true, once: true },
      )
    })
    Object.assign(window, { showDirectoryPicker: () => picked })
  })
  const list = page.getByTestId('projects-folders')
  await dropFolder(page, list, folder)
  await list.getByRole('button', { name: 'Add folder' }).click()
}

/** Forgets what the page kept of an earlier test (its folders), and loads it anew. */
export async function startAnew(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        localStorage.clear()
        const gone = indexedDB.deleteDatabase('livesaver')
        gone.onsuccess = gone.onerror = gone.onblocked = () => resolve()
      }),
  )
  await page.reload()
  await page.getByTestId('search-folders').waitFor()
}
