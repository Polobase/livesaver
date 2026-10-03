/**
 * The docs as the site shows them, checked without building it: every Markdown file of `docs/`
 * has its place in the navigation, and every link and picture in them leads somewhere.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { darkTwin, docHref, docImage, REPOSITORY } from '../app/utils/links.js'
import { navigationOf, ORDER, SECTIONS, sectionOf, surroundOf } from '../app/utils/navigation.js'

const REPO = join(import.meta.dir, '..', '..', '..')
const DOCS = join(REPO, 'docs')
/** Not part of the site (see `content.config.ts`). */
const LEFT_OUT = new Set(['releasing.md'])

function markdownIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? markdownIn(join(dir, entry.name))
      : entry.name.endsWith('.md')
        ? [join(dir, entry.name)]
        : [],
  )
}

/** A doc with its place below `docs/` (without `.md`) and the route the site gives it. */
const docs = markdownIn(DOCS)
  .map((file) => relative(DOCS, file))
  .filter((file) => !LEFT_OUT.has(file))
  .map((file) => {
    const stem = file.replace(/\.md$/, '')
    return {
      file,
      stem,
      route: `/docs/${stem.replace(/(^|\/)README$/, '').replace(/\/$/, '')}`.toLowerCase(),
      text: readFileSync(join(DOCS, file), 'utf8'),
    }
  })
const routes = new Set(docs.map((doc) => doc.route))

/** The headings of a doc as the ids the site gives them (as GitHub does). */
function anchorsOf(text: string): Set<string> {
  const ids = new Set<string>()
  for (const line of text.replace(/```[\s\S]*?```/g, '').split('\n')) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (!heading) continue
    ids.add(
      (heading[1] as string)
        .toLowerCase()
        .replace(/[`*_]/g, '')
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .trim()
        .replace(/\s+/g, '-'),
    )
  }
  return ids
}

/** The links and pictures of a doc, code left out (a `](` in code is no link). */
function linksOf(text: string): { href: string; image: boolean }[] {
  const prose = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
  return [...prose.matchAll(/(!?)\[[^\]]*\]\(([^)\s]+)\)/g)].map((match) => ({
    href: match[2] as string,
    image: match[1] === '!',
  }))
}

describe('a link in a doc', () => {
  test('to another doc leads to its page, from wherever the doc lies', () => {
    expect(docHref('fileref.md', 'format/README')).toBe('/docs/format/fileref')
    expect(docHref('../format/fingerprints.md', 'guide/samples')).toBe('/docs/format/fingerprints')
    expect(docHref('web.md', 'verification')).toBe('/docs/web')
    expect(docHref('samples.md#uncertain-matches', 'guide/missing')).toBe(
      '/docs/guide/samples#uncertain-matches',
    )
    // The README of a folder is the folder's page.
    expect(docHref('../format/README.md', 'guide/getting-started')).toBe('/docs/format')
    expect(docHref('./history.md', 'guide/samples')).toBe('/docs/guide/history')
  })

  test('to a file outside the docs leads to the repository', () => {
    expect(docHref('../fixtures/README.md', 'verification')).toBe(
      `${REPOSITORY}/blob/main/fixtures/README.md`,
    )
    expect(docHref('../examples/codemods', 'codemods')).toBe(
      `${REPOSITORY}/tree/main/examples/codemods`,
    )
    expect(docHref('../../packages/core/src/crc.ts', 'format/fingerprints')).toBe(
      `${REPOSITORY}/blob/main/packages/core/src/crc.ts`,
    )
  })

  test('that is no path stays as it is', () => {
    for (const href of ['#a-scan', 'https://bun.sh', 'mailto:someone@example.com', '/docs/web', ''])
      expect(docHref(href, 'guide/samples')).toBe(href)
  })

  test('a picture is served from beside its doc, and one taken in light has a dark twin', () => {
    expect(docImage('images/overview-light.webp', 'guide/getting-started')).toBe(
      '/docs/guide/images/overview-light.webp',
    )
    expect(docImage('https://example.com/x.png', 'guide/samples')).toBe('https://example.com/x.png')
    expect(darkTwin('/docs/guide/images/overview-light.webp')).toBe(
      '/docs/guide/images/overview-dark.webp',
    )
    expect(darkTwin('/docs/guide/images/diagram.svg')).toBeUndefined()
  })
})

describe('the docs of the repository', () => {
  test('each has its place in the navigation, once; and nothing is listed that is not there', () => {
    expect([...ORDER].sort()).toEqual([...routes].sort())
    expect(new Set(ORDER).size).toBe(ORDER.length)
  })

  test('each starts with its title and says in its first words what it is about', () => {
    for (const doc of docs) {
      const [first, , third] = doc.text.split('\n')
      expect([doc.file, /^# \S/.test(first ?? '')]).toEqual([doc.file, true])
      // The first paragraph is what a list of pages and a search engine show.
      expect([doc.file, (third ?? '').length > 40]).toEqual([doc.file, true])
    }
  })

  test('every link leads to a doc, a heading or a file that is there', () => {
    const broken: string[] = []
    for (const doc of docs) {
      for (const { href, image } of linksOf(doc.text)) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue
        const to = image ? docImage(href, doc.stem) : docHref(href, doc.stem)
        const [path = '', anchor] = to.split('#')
        const target = docs.find((other) => other.route === (path || doc.route))
        if (image) {
          if (!existsSync(join(REPO, path))) broken.push(`${doc.file}: picture ${href}`)
          const twin = darkTwin(path)
          if (twin && !existsSync(join(REPO, twin))) broken.push(`${doc.file}: no dark ${href}`)
        } else if (to.startsWith(REPOSITORY)) {
          const file = to.replace(/^.*?\/(blob|tree)\/main\//, '').split('#')[0] as string
          if (!existsSync(join(REPO, file))) broken.push(`${doc.file}: ${href}`)
        } else if (!target) broken.push(`${doc.file}: ${href}`)
        else if (anchor && !anchorsOf(target.text).has(anchor))
          broken.push(`${doc.file}: ${href} (no such heading)`)
      }
    }
    expect(broken).toEqual([])
  })

  test('the pictures of the guides are all used', () => {
    const used = new Set(
      docs.flatMap((doc) =>
        linksOf(doc.text)
          .filter((link) => link.image)
          .flatMap(({ href }) => {
            const light = docImage(href, doc.stem)
            return [light, darkTwin(light) ?? light]
          }),
      ),
    )
    // The landing page shows pictures of the guides, by name.
    const landing = readFileSync(join(REPO, 'apps', 'site', 'app', 'pages', 'index.vue'), 'utf8')
    for (const [, name] of landing.matchAll(/<AppShot\s+name="([a-z-]+)"/g))
      for (const scheme of ['light', 'dark']) used.add(`/docs/guide/images/${name}-${scheme}.webp`)
    const there = readdirSync(join(DOCS, 'guide', 'images')).map(
      (name) => `/docs/guide/images/${name}`,
    )
    expect(there.filter((picture) => !used.has(picture))).toEqual([])
  })
})

describe('the navigation', () => {
  const entries = docs.map((doc) => ({
    path: doc.route,
    title: (/^# (.*)$/m.exec(doc.text)?.[1] ?? '').trim(),
  }))

  test('lists the sections with their pages, titled as the pages are or shorter', () => {
    const navigation = navigationOf(entries)
    expect(navigation.map((section) => section.title)).toEqual(
      SECTIONS.map((section) => section.title),
    )
    const guide = navigation[0]?.children ?? []
    expect(guide[0]).toEqual({ title: 'Getting started', path: '/docs/guide/getting-started' })
    expect(guide.find((item) => item.path === '/docs/guide/safety')?.title).toBe('Safety')
    // The page one is on is marked for assistive technology, and only that one.
    const marked = navigationOf(entries, '/docs/guide/safety')
      .flatMap((section) => section.children ?? [])
      .filter((item) => item['aria-current'] === 'page')
    expect(marked.map((item) => item.path)).toEqual(['/docs/guide/safety'])
    // Short enough for the list beside a page: a longer one is cut off there.
    for (const item of navigation.flatMap((section) => section.children ?? []))
      expect([item.title, item.title.length <= 24]).toEqual([item.title, true])
  })

  test('knows the section of a page, and the pages before and after it', () => {
    expect(sectionOf('/docs/format/fileref')?.title).toBe('File formats')
    expect(sectionOf('/docs/nothing')).toBeUndefined()
    const [before, after] = surroundOf('/docs/guide/samples', entries)
    expect([before?.path, after?.path]).toEqual([
      '/docs/guide/getting-started',
      '/docs/guide/missing',
    ])
    expect(surroundOf(ORDER[0] as string, entries)[0]).toBeUndefined()
    expect(surroundOf(ORDER.at(-1) as string, entries)[1]).toBeUndefined()
    expect(surroundOf('/docs/nothing', entries)).toEqual([undefined, undefined])
  })
})
