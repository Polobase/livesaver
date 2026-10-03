/** What every browser test needs: the three browser engines, a page that is watched, axe. */
import { AxeBuilder } from '@axe-core/playwright'
import { type Browser, type BrowserType, chromium, firefox, type Page, webkit } from 'playwright'

export const ENGINES: readonly (readonly [name: string, type: BrowserType])[] = [
  ['Chromium', chromium],
  ['WebKit', webkit],
  ['Firefox', firefox],
]

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
  })
  const page = await context.newPage()
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

/** Findings of axe that keep someone from using the page (serious and critical). */
export async function barriers(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).analyze()
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
}
