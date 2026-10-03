/**
 * The order of the docs. The files in `docs/` have plain names (no numbers in front, no front
 * matter), so that they read well on GitHub; what comes after what is said here.
 */

export interface DocSection {
  readonly title: string
  readonly icon: string
  readonly description: string
  /** Routes of the pages, in order; with a label where the page's own title is too long for a list. */
  readonly pages: readonly (readonly [path: string, label?: string])[]
}

export const SECTIONS: readonly DocSection[] = [
  {
    title: 'Guide',
    icon: 'i-lucide-book-open',
    description: 'From the first scan to an undo: how to get your projects complete again.',
    pages: [
      ['/docs/guide/getting-started'],
      ['/docs/guide/samples'],
      ['/docs/guide/missing', 'Samples still missing'],
      ['/docs/guide/plugins'],
      ['/docs/guide/history'],
      ['/docs/guide/browser'],
      ['/docs/guide/command-line'],
      ['/docs/guide/safety', 'Safety'],
      ['/docs/guide/questions'],
    ],
  },
  {
    title: 'File formats',
    icon: 'i-lucide-file-code',
    description: 'What livesaver relies on in the files of Live: facts, each with its source.',
    pages: [
      ['/docs/format', 'Overview'],
      ['/docs/format/containers', 'Containers'],
      ['/docs/format/versions', 'Versions'],
      ['/docs/format/fileref'],
      ['/docs/format/fingerprints'],
      ['/docs/format/live-setup', 'Live’s own files'],
      ['/docs/format/plugins', 'Plug-ins'],
      ['/docs/format/finder', 'Finder and bundles'],
    ],
  },
  {
    title: 'Under the hood',
    icon: 'i-lucide-wrench',
    description: 'How the web app works, how to write a codemod, and how all of it is tested.',
    pages: [['/docs/web'], ['/docs/codemods'], ['/docs/verification', 'How it is tested']],
  },
]

export interface DocEntry {
  readonly path: string
  readonly title: string
  readonly description?: string
}

export interface NavItem {
  title: string
  path: string
  icon?: string
  children?: NavItem[]
  /** A list of the site may add what it shows beside a page (a badge, a target). */
  [key: string]: unknown
}

/**
 * The sections with their pages, titled as the pages title themselves. `current`: the page one
 * is on, which is marked as such for assistive technology (the list only colours it).
 */
export function navigationOf(docs: readonly DocEntry[], current = ''): NavItem[] {
  const titles = new Map(docs.map((doc) => [doc.path, doc.title]))
  return SECTIONS.map((section) => ({
    title: section.title,
    icon: section.icon,
    path: section.pages[0]?.[0] ?? '/docs',
    children: section.pages.map(([path, label]) => ({
      title: label ?? titles.get(path) ?? path,
      path,
      ...(path === current ? { 'aria-current': 'page' } : {}),
    })),
  }))
}

/** Every page in reading order. */
export const ORDER: readonly string[] = SECTIONS.flatMap((section) =>
  section.pages.map(([path]) => path),
)

/** The section a page belongs to. */
export const sectionOf = (path: string): DocSection | undefined =>
  SECTIONS.find((section) => section.pages.some(([page]) => page === path))

/** The pages before and after a page, for the links at its end. */
export function surroundOf(
  path: string,
  docs: readonly DocEntry[],
): [DocEntry | undefined, DocEntry | undefined] {
  const at = ORDER.indexOf(path)
  const entry = (index: number) => docs.find((doc) => doc.path === ORDER[index])
  return at < 0 ? [undefined, undefined] : [entry(at - 1), entry(at + 1)]
}
