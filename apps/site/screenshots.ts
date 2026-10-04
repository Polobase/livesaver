/**
 * Takes the pictures of the app that the guides and the landing page show, in light and dark,
 * into `docs/guide/images/`. The app runs on a made-up library in a temporary folder
 * (`demoLibrary` of the test kit) with a made-up set of installed plug-ins: nothing of this
 * computer is in a picture. Fixes and an upgrade are really applied there, so that the history
 * has runs to show.
 *
 * Usage: bun screenshots.ts   (needs `bun run build` and Playwright's Chromium)
 */
import { cpSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Catalog, type InstalledPlugin, Inventory } from '@livesaver/plugins'
import { demoLibrary, fixturesDir, tempDir } from '@livesaver/test-kit'
import { startWeb } from 'livesaver'
import { type Browser, chromium, type Page } from 'playwright'
import { DIST as APP, build as buildApp } from '../web/build.js'
import { serve as serveApp } from '../web/serve.js'

const OUT = join(import.meta.dir, '..', '..', 'docs', 'guide', 'images')
const SIZE = { width: 1280, height: 800 }
/** Where the pictures say the library lies: a place anyone has, not a temporary folder. */
const SHOWN = '/Users/you/Music'

const MASSIVE = '5653544e694d616d6173736976650000'
const SERUM = '56535458667358736572756d00000000'
const plugin = (
  format: InstalledPlugin['format'],
  ident: string,
  name: string,
  native = true,
  scanned = true,
): InstalledPlugin => ({
  format,
  ident,
  name,
  path: `/Library/Audio/Plug-Ins/${format === 'AU' ? 'Components' : format}/${name}.${format === 'AU' ? 'component' : format.toLowerCase()}`,
  native,
  scanned,
})
const INSTALLED = new Inventory([
  plugin('VST2', '1483109208', 'Serum', false),
  plugin('VST3', SERUM, 'Serum'),
  plugin('VST3', MASSIVE, 'Massive'),
  plugin('VST3', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Pro-Q 3'),
  plugin('AU', 'aufx:PrQ3:FabF', 'FabFilter: Pro-Q 3'),
  plugin('VST3', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'Old Reverb', false),
  plugin('VST2', '1111111111', 'Tape Thing', true, false),
])
const CATALOG: Catalog = new Map([
  [MASSIVE, { devIdentifier: `device:vst3:instr:${MASSIVE}`, name: 'Massive' }],
  [SERUM, { devIdentifier: `device:vst3:instr:${SERUM}`, name: 'Serum' }],
])

/** A picture of the page as WebP: a browser encodes it, so nothing else has to be installed. */
async function webp(browser: Browser, png: Buffer): Promise<Buffer> {
  const page = await browser.newPage()
  const data = await page.evaluate(
    async (source) => {
      const image = new Image()
      image.src = source
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      canvas.getContext('2d')?.drawImage(image, 0, 0)
      return canvas.toDataURL('image/webp', 0.86)
    },
    `data:image/png;base64,${png.toString('base64')}`,
  )
  await page.close()
  return Buffer.from(data.slice(data.indexOf(',') + 1), 'base64')
}

async function shots(scheme: 'light' | 'dark'): Promise<void> {
  const tmp = tempDir()
  const demo = demoLibrary(tmp.path, 12)
  // A set that Live saved with VST2 devices and their VST3 versions, under a name of its own.
  const layers = join(demo.projects, 'Synth Layers Project')
  cpSync(join(fixturesDir(), 'projects', 'VST2toVST3 Project'), layers, { recursive: true })
  renameSync(join(layers, 'VST2toVST3.als'), join(layers, 'Synth Layers.als'))
  process.env.LIVESAVER_HOME = join(tmp.path, 'home')
  process.env.LIVESAVER_TRASH_DIR = join(tmp.path, 'trash')
  // Live's own content, as a Live app has it: without it the overview warns, rightly, that
  // samples of the Core Library cannot be found.
  const resources = join(tmp.path, 'Ableton Live 12 Suite.app', 'Contents', 'App-Resources')
  mkdirSync(join(resources, 'Core Library', 'Samples'), { recursive: true })
  const config = join(tmp.path, 'config.json')
  writeFileSync(
    config,
    JSON.stringify({
      userLibrary: join(tmp.path, 'Ableton', 'User Library'),
      factoryPacks: join(tmp.path, 'Ableton', 'Factory Packs'),
      appResources: resources,
      vendorLibraries: [demo.library],
      searchRoots: [demo.samples, demo.library, join(resources, 'Core Library')],
      status: { projects: demo.projects },
    }),
  )
  const server = await startWeb({
    assets: APP,
    config,
    liveRunning: () => false,
    version: '0.1.0',
    plugins: async () => ({ inventory: INSTALLED, catalog: CATALOG }),
    reveal: async () => {},
  })
  const alone = serveApp()
  const browser = await chromium.launch()
  const context = await browser.newContext({
    colorScheme: scheme,
    viewport: SIZE,
    deviceScaleFactor: 2,
  })
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)
  // The pictures name the folders as anyone's, in what the page is told and in what it asks.
  await page.route(`${server.url}api/**`, async (route) => {
    const request = route.request()
    const sent = request.postData()
    const response = await route.fetch(
      sent === null ? {} : { postData: sent.replaceAll(SHOWN, tmp.path) },
    )
    const text = await response.text()
    await route.fulfill({ response, body: text.replaceAll(tmp.path, SHOWN) })
  })

  const shot = async (name: string, from: Page = page) => {
    // What fades in has arrived.
    await from.evaluate(() =>
      Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
    )
    await from.waitForTimeout(150)
    writeFileSync(join(OUT, `${name}-${scheme}.webp`), await webp(browser, await from.screenshot()))
    console.log(`${name}-${scheme}.webp`)
  }
  const fix = async () => {
    await page.getByTestId('review-continue').click()
    await page.getByTestId('review-apply').click()
    await page.getByTestId('review-done').click()
  }

  await page.goto(server.url)
  await page.getByTestId('scan-library').click()
  await page.getByTestId('fix-card').waitFor()
  await shot('overview')

  await page.getByTestId('review').click()
  await page.getByTestId('review-plan').waitFor()
  await shot('review')
  await page.keyboard.press('Escape')

  await page.goto(`${server.url}#/samples`)
  await page.getByRole('table').waitFor()
  await shot('projects')
  await page.goto(`${server.url}#/samples?tab=missing`)
  await page.getByTestId('missing-groups').locator('button[aria-expanded]').first().click()
  await shot('missing')
  await page.goto(`${server.url}#/samples?tab=changes`)
  await page.getByRole('table').waitFor()
  await shot('changes')

  await page.goto(`${server.url}#/plugins`)
  await page.getByRole('table').waitFor()
  await shot('plugins')
  await page.goto(`${server.url}#/plugins?tab=upgrade`)
  await page.getByTestId('upgrade-plugins').waitFor()
  await shot('upgrade')

  // The app on its own, before anything is changed: it reads the same library, handed over.
  const own = await context.newPage()
  await own.goto(alone.url)
  await own.getByTestId('projects-input').setInputFiles(demo.projects)
  await own.getByTestId('search-input').setInputFiles(demo.samples)
  await own.getByTestId('scan-library').click()
  await own.getByTestId('fix-card').waitFor()
  await shot('browser', own)
  // What it says about fixing from there, for the browser it is in.
  await own.getByTestId('how-to-fix').click()
  await own.getByTestId('where-dialog').waitFor()
  await shot('ways', own)
  await own.close()

  // Runs for the history: one project fixed alone, then the rest, then an upgrade.
  await page.goto(`${server.url}#/samples`)
  await page.getByRole('button', { name: 'Fix Night Drive Project' }).click()
  await fix()
  await page.goto(server.url)
  await page.getByTestId('review').click()
  await fix()
  await page.getByTestId('fixed').waitFor()
  await page.goto(`${server.url}#/plugins?tab=upgrade`)
  await page.getByTestId('review-upgrade').click()
  await page.getByTestId('upgrade-continue').click()
  await page.getByTestId('upgrade-apply').click()
  await page.getByTestId('upgrade-done').click()
  await page.getByTestId('upgraded').waitFor()

  await page.goto(`${server.url}#/history`)
  await page.getByTestId('run').first().waitFor()
  await shot('history')
  await page
    .getByRole('button', { name: /^Details: Fixed/ })
    .first()
    .click()
  await page.getByTestId('steps').waitFor()
  await shot('run')

  await browser.close()
  await server.close()
  alone.stop()
  tmp.cleanup()
}

await buildApp()
mkdirSync(OUT, { recursive: true })
for (const scheme of ['light', 'dark'] as const) await shots(scheme)
