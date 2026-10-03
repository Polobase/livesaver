/** What every browser test needs: the three browser engines, a page that is watched, axe. */
import { join } from 'node:path'
import { AxeBuilder } from '@axe-core/playwright'
import { Inventory } from '@livesaver/plugins'
import type { WebServer } from 'livesaver'
import {
  type Browser,
  type BrowserType,
  chromium,
  firefox,
  type Locator,
  type Page,
  webkit,
} from 'playwright'

export const ENGINES: readonly (readonly [name: string, type: BrowserType])[] = [
  ['Chromium', chromium],
  ['WebKit', webkit],
  ['Firefox', firefox],
]

/**
 * A machine of a CI is shared, and slower in spurts: what is waited for there gets more time.
 * (Nothing is waited for longer when it is there in time.)
 */
export const PATIENCE = process.env.CI ? 3 : 1

export interface Watched {
  readonly page: Page
  /** Errors of the page and its console. */
  readonly problems: string[]
  /** Requests that left the page's own address: there must be none. */
  readonly outside: string[]
}

/** A page whose errors and requests are recorded, so a test can demand that there are none. */
export async function watch(
  browser: Browser,
  origin: string,
  scheme: 'light' | 'dark' = 'light',
): Promise<Watched> {
  // A context of its own: axe needs one, and nothing is shared between tests.
  const context = await browser.newContext({
    colorScheme: scheme,
    viewport: { width: 1280, height: 800 },
    // The browser and livesaver are on one computer, so in one time zone: the one of this
    // process (a test runner may set its own, whatever the system's is).
    timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
  const page = await context.newPage()
  // Something that never appears fails with what was waited for, not with a test's time limit.
  page.setDefaultTimeout(15_000 * PATIENCE)
  const problems: string[] = []
  const outside: string[] = []
  page.on('pageerror', (error) => problems.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text())
  })
  page.on('request', (request) => {
    const url = request.url()
    if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:'))
      outside.push(url)
  })
  return { page, problems, outside }
}

/**
 * The key that goes with K, A and the like on the system the page believes it is on: ⌘ on a
 * Mac, Ctrl elsewhere. The page goes by what the browser says it runs on, and a test browser
 * may say something else than the machine is (WebKit calls itself a Mac on Linux, too).
 */
export async function commandKey(page: Page): Promise<'Meta' | 'Control'> {
  return (await page.evaluate(() => navigator.userAgent.includes('Macintosh'))) ? 'Meta' : 'Control'
}

/**
 * Hands a folder to the page through one of its folder inputs, as choosing it in the dialog
 * does. A browser on a busy machine does not always take the folder at once: it is handed
 * again, unless a row for it has appeared in the meantime.
 */
export async function giveFolder(page: Page, input: string, folder: string): Promise<void> {
  const rows = page.getByTestId('folder-row')
  const before = await rows.count()
  for (let tries = 1; ; tries++) {
    try {
      await page.getByTestId(input).setInputFiles(folder, { timeout: 10_000 })
      return
    } catch (error) {
      if ((await rows.count()) > before) return
      if (tries === 3) throw error
    }
  }
}

/**
 * Presses the button that closes a dialog, and sees it closed. A press that falls into the
 * moment a dialog rearranges itself is lost, as it would be for a person, who presses again.
 */
export async function closeWith(dialog: Locator, button: Locator): Promise<void> {
  for (let tries = 0; tries < 4; tries++) {
    await button.click({ timeout: 5000 * PATIENCE }).catch(() => {})
    try {
      await dialog.waitFor({ state: 'hidden', timeout: 3000 * PATIENCE })
      return
    } catch {}
  }
  await dialog.waitFor({ state: 'hidden' })
}

/** Findings of axe that keep someone from using the page (serious and critical). */
export async function barriers(page: Page): Promise<string[]> {
  // What fades in is judged when it is there: half-way, its text has no contrast yet.
  await page.evaluate(() =>
    Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
    ),
  )
  const { violations } = await new AxeBuilder({ page }).analyze()
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
}

/** What an element says, as one line: its layout may break the text anywhere. */
export async function textOf(locator: Locator): Promise<string> {
  return (await locator.innerText()).replace(/\s+/g, ' ').trim()
}

/** The text of each element as written, without what the layout adds between its parts. */
export async function textsOf(locator: Locator): Promise<string[]> {
  return locator.evaluateAll((elements) =>
    elements.map((element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim()),
  )
}

/**
 * A run goes on when its page is gone. The servers of these tests share one process, and with it
 * the place livesaver keeps its notes in: a run must have ended before the next server starts.
 */
export async function idle(server: WebServer): Promise<void> {
  for (;;) {
    const answer = await fetch(`${server.url}api/status`, {
      headers: { 'x-livesaver-token': server.token },
    })
    if (!((await answer.json()) as { busy: string }).busy) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/** Nothing of this computer's plug-ins: these tests are about samples. */
export const noPlugins = async () => ({ inventory: new Inventory([]), catalog: new Map() })

/** livesaver's own state and the Trash of an undo, in the temporary folder of a test. */
export function stateIn(folder: string): void {
  process.env.LIVESAVER_HOME = join(folder, 'home')
  process.env.LIVESAVER_TRASH_DIR = join(folder, 'trash')
}

const saved = { home: process.env.LIVESAVER_HOME, trash: process.env.LIVESAVER_TRASH_DIR }

/** Puts livesaver's state back where it was before the tests. */
export function restoreState(): void {
  for (const [key, value] of [
    ['LIVESAVER_HOME', saved.home],
    ['LIVESAVER_TRASH_DIR', saved.trash],
  ] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

/**
 * Waits until the page says what is expected: after a fix or an undo the app scans again, and
 * what it shows changes when that scan is over.
 */
export async function eventually<T>(read: () => Promise<T>, expected: T, ms = 30_000): Promise<T> {
  const wanted = JSON.stringify(expected)
  const end = Date.now() + ms
  let last = await read()
  while (JSON.stringify(last) !== wanted && Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    last = await read()
  }
  return last
}

/** The rows of a table as the text of their cells. */
export async function cellsOf(rows: Locator): Promise<string[][]> {
  return rows.evaluateAll((all) =>
    all.map((row) =>
      [...row.querySelectorAll('td')].map((cell) =>
        (cell.textContent ?? '').replace(/\s+/g, ' ').trim(),
      ),
    ),
  )
}
