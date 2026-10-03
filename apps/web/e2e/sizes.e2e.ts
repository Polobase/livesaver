/**
 * A library of real size, in the three browser engines: 299 projects, 876 sets, 9,305 planned
 * changes, 2,243 missing samples, 199 plug-ins. The scan is made up from a small real one (its
 * rows repeated under other names), and handed to the app as the scan livesaver kept. What is
 * tested is that the screens stay quick with it: a table builds the rows in view and not all of
 * them, and sorting, searching and scrolling answer at once.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { demoLibrary, tempDir } from '@livesaver/test-kit'
import { startWeb, type WebLastScan, type WebServer } from 'livesaver'
import type { Browser, Page } from 'playwright'
import { build, DIST } from '../build.js'
import {
  ENGINES,
  eventually,
  idle,
  noPlugins,
  restoreState,
  stateIn,
  textOf,
  watch,
} from './support.js'

const SIZES = { projects: 299, sets: 876, changes: 9305, missing: 2243, plugins: 199 }
/** A table may build the rows in view and some beyond them, never the whole list. */
const ROWS_IN_PAGE = 80
/**
 * Generous: a browser on a busy machine takes its time. Building every row of the longest
 * table, which is what these limits guard against, takes many times as long.
 */
const AT_ONCE = 3000
const SMOOTH = 500

const pad = (n: number) => String(n).padStart(4, '0')
const times = <T>(n: number, make: (i: number) => T): T[] =>
  Array.from({ length: n }, (_, i) => make(i))

/** The small scan with its rows repeated up to the sizes of a large library. */
function inflate(kept: WebLastScan): WebLastScan {
  const { samples, plugins } = kept.scan
  const [project, set, change, missing, use] = [
    samples.projectRows[0],
    samples.setRows[0],
    samples.changes[0],
    samples.missing[0],
    plugins.uses[0],
  ]
  if (!project || !set || !change || !missing || !use)
    throw new Error('The small scan lacks a row of some kind.')
  const projectOf = (i: number) => `Project ${pad(i % SIZES.projects)}`
  const setOf = (i: number) => `Set ${pad(i % SIZES.sets)}.als`
  return {
    ...kept,
    scan: {
      ...kept.scan,
      samples: {
        ...samples,
        projectRows: times(SIZES.projects, (i) => ({
          ...project,
          root: `${samples.base}/${projectOf(i)}`,
          path: projectOf(i),
        })),
        setRows: times(SIZES.sets, (i) => ({
          ...set,
          path: `${projectOf(i)}/${setOf(i)}`,
          project: projectOf(i),
          name: setOf(i),
        })),
        changes: times(SIZES.changes, (i) => ({
          ...change,
          project: projectOf(i),
          set: setOf(i),
          setPath: `${projectOf(i)}/${setOf(i)}`,
          name: `Sample ${pad(i)}.wav`,
          newPath: `Samples/Imported/Sample ${pad(i)}.wav`,
        })),
        missing: times(SIZES.missing, (i) => ({
          ...missing,
          name: `Gone ${pad(i)}.wav`,
          path: `/Volumes/Old Drive/Tapes/Gone ${pad(i)}.wav`,
        })),
      },
      plugins: {
        ...plugins,
        uses: times(SIZES.plugins, (i) => ({
          ...use,
          key: `${use.key} ${i}`,
          name: `Plug-in ${pad(i)}`,
        })),
      },
    },
  }
}

beforeAll(async () => {
  await build()
}, 120_000)
afterAll(restoreState)

for (const [name, type] of ENGINES) {
  describe(`a library of real size in ${name}`, () => {
    let browser: Browser
    let page: Page
    let server: WebServer
    let tmp: { path: string; cleanup: () => void }
    let big: WebLastScan
    let problems: string[]

    beforeAll(async () => {
      tmp = tempDir()
      const demo = demoLibrary(tmp.path, 4)
      stateIn(tmp.path)
      const config = join(tmp.path, 'config.json')
      writeFileSync(
        config,
        JSON.stringify({ appResources: '', vendorLibraries: [], searchRoots: [demo.samples] }),
      )
      server = await startWeb({ assets: DIST, config, force: true, plugins: noPlugins })
      const headers = { 'x-livesaver-token': server.token, 'Content-Type': 'application/json' }
      const scanned = await fetch(`${server.url}api/scan`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          projects: [demo.projects],
          search: [{ path: demo.samples, vendor: false }],
          options: { packLimitMB: 50, matchLibraryPath: false },
        }),
      })
      await scanned.text()
      big = inflate(
        (await (await fetch(`${server.url}api/scan`, { headers })).json()) as WebLastScan,
      )
      browser = await type.launch()
      ;({ page, problems } = await watch(browser, server.url))
      // The app asks for the scan livesaver kept, and gets the large one.
      await page.route(`${server.url}api/scan`, (route) =>
        route.request().method() === 'GET' ? route.fulfill({ json: big }) : route.continue(),
      )
      await page.goto(`${server.url}#/samples?tab=changes`)
    }, 120_000)
    afterAll(async () => {
      await browser?.close()
      if (server) await idle(server)
      await server?.close()
      tmp?.cleanup()
    })

    const rows = () => page.locator('table tbody tr[data-slot=tr]')
    const shown = () => textOf(page.getByTestId('shown'))
    const firstRow = async () => textOf(rows().first())
    /** How long the page takes to show what is waited for, from the click or the key on. */
    const timed = async (act: () => Promise<unknown>): Promise<number> => {
      const started = performance.now()
      await act()
      return performance.now() - started
    }
    /** Scrolls the table to its end in steps, and says the longest wait for a frame. */
    const worstFrame = () =>
      page.evaluate(async () => {
        const box = document.querySelector('table')?.parentElement
        if (!box) throw new Error('no table')
        let worst = 0
        let last = performance.now()
        const steps = 40
        for (let step = 1; step <= steps; step++) {
          box.scrollTop = ((box.scrollHeight - box.clientHeight) * step) / steps
          await new Promise((resolve) => requestAnimationFrame(resolve))
          const now = performance.now()
          worst = Math.max(worst, now - last)
          last = now
        }
        return worst
      })

    test('thousands of planned changes: only the rows in view are built', async () => {
      await rows().first().waitFor()
      expect(await shown()).toBe('9,305 of 9,305')
      expect(await rows().count()).toBeLessThan(ROWS_IN_PAGE)
      expect(await firstRow()).toContain('Sample 0000.wav')
      // To the end of the list and back, without a frame that makes one wait.
      expect(await worstFrame()).toBeLessThan(SMOOTH)
      await rows().filter({ hasText: 'Sample 9304.wav' }).waitFor()
      expect(await rows().count()).toBeLessThan(ROWS_IN_PAGE)
    }, 60_000)

    test('they are sorted and searched at once', async () => {
      const sample = page.getByRole('button', { name: 'Sample', exact: true })
      // Ascending is the order they are in; descending turns nine thousand rows around.
      await sample.click()
      const sorted = await timed(async () => {
        await sample.click()
        await rows().first().getByText('Sample 9304.wav').waitFor()
      })
      expect(sorted).toBeLessThan(AT_ONCE)

      // Every word of the search has to occur in a row, as in the app.
      const words = ['sample', '930']
      const expected = big.scan.samples.changes.filter((row) => {
        const text =
          `${row.project} ${row.set} ${row.name} ${row.oldPath} ${row.newPath} ${row.source}`.toLowerCase()
        return words.every((word) => text.includes(word))
      }).length
      expect(expected).toBeGreaterThan(5)
      const wanted = `${expected} of 9,305`
      const searched = await timed(async () => {
        await page.getByLabel('Search planned changes').fill(words.join(' '))
        expect(await eventually(shown, wanted)).toBe(wanted)
      })
      expect(searched).toBeLessThan(AT_ONCE)
      expect(await rows().count()).toBe(expected)
      await page.getByLabel('Search planned changes').fill('')
      expect(await eventually(shown, '9,305 of 9,305')).toBe('9,305 of 9,305')
    }, 60_000)

    test('the projects, the sets, the missing samples and the plug-ins come as fast', async () => {
      for (const [tab, all] of [
        ['Projects', '299 of 299'],
        ['Sets', '876 of 876'],
      ] as const) {
        const opened = await timed(async () => {
          await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click()
          expect(await eventually(shown, all)).toBe(all)
          await rows().first().waitFor()
        })
        expect([tab, opened < AT_ONCE]).toEqual([tab, true])
        expect(await rows().count()).toBeLessThan(ROWS_IN_PAGE)
        expect([tab, (await worstFrame()) < SMOOTH]).toEqual([tab, true])
      }

      // The missing samples are listed by where they came from, a page of each source at a time.
      await page.getByRole('tab', { name: /^Missing/ }).click()
      expect(await eventually(shown, '2,243 of 2,243')).toBe('2,243 of 2,243')
      const group = page.getByTestId('missing-groups').locator('> li').first()
      const openedGroup = await timed(async () => {
        await group.getByRole('button', { expanded: false }).click()
        await group.locator('tbody tr').first().waitFor()
      })
      expect(openedGroup).toBeLessThan(AT_ONCE)
      expect(await group.locator('tbody tr').count()).toBe(50)
      expect(await textOf(group.getByRole('button', { name: /^Show more/ }))).toMatch(
        /^Show more \([\d,]+ left\)$/,
      )

      await page.getByRole('link', { name: 'Plug-ins', exact: true }).click()
      expect(await eventually(shown, '199 of 199')).toBe('199 of 199')
      await rows().first().waitFor()
      expect(await rows().count()).toBeLessThan(ROWS_IN_PAGE)
      expect(problems).toEqual([])
    }, 90_000)
  })
}
