/**
 * The docs are written for two places: GitHub shows the Markdown files as they lie in the
 * repository, the site shows them as pages. A link in them is relative to its file; here it
 * becomes the page of the site, or, for a file outside `docs/`, its place on GitHub.
 */

export const REPOSITORY = 'https://github.com/Polobase/livesaver'

const isAbsolute = (href: string) =>
  href.startsWith('#') || href.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(href)

/** The path in the repository that `href` means, written in the file `docs/<stem>.md`. */
function resolve(href: string, stem: string): string[] {
  const parts = ['docs', ...stem.split('/').slice(0, -1)]
  for (const part of href.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return parts
}

/**
 * Where a link of a doc leads on the site. `stem`: the doc's path below `docs/`, without
 * `.md` (`format/README`, `web`).
 */
export function docHref(href: string, stem: string): string {
  if (!href || isAbsolute(href)) return href
  const [path = '', hash] = href.split('#')
  const anchor = hash ? `#${hash}` : ''
  const parts = resolve(path, stem)
  if (parts[0] === 'docs' && path.endsWith('.md')) {
    // A page of the site: the README of a folder is the folder's page.
    const route = parts
      .join('/')
      .replace(/\.md$/, '')
      .replace(/\/README$/i, '')
    return `/${route.toLowerCase()}${anchor}`
  }
  const last = parts.at(-1) ?? ''
  return `${REPOSITORY}/${last.includes('.') ? 'blob' : 'tree'}/main/${parts.join('/')}${anchor}`
}

/** Where a picture of a doc lies on the site: its pictures are served from where they lie. */
export function docImage(src: string, stem: string): string {
  if (!src || isAbsolute(src)) return src
  return `/${resolve(src, stem).join('/')}`
}

/** A picture taken in light has a twin taken in dark: `overview-light.webp`, `overview-dark.webp`. */
export function darkTwin(src: string): string | undefined {
  return /-light\.[a-z]+$/.test(src) ? src.replace(/-light(\.[a-z]+)$/, '-dark$1') : undefined
}
