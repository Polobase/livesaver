import { defineCollection, defineContentConfig } from '@nuxt/content'

/** The site's pages are the repository's `docs/`: one source for GitHub and for the site. */
export default defineContentConfig({
  collections: {
    docs: defineCollection({
      type: 'page',
      source: {
        cwd: '../../docs',
        include: '**/*.md',
        // For maintainers, not for readers of the site.
        exclude: ['releasing.md'],
        prefix: '/docs',
      },
    }),
  },
})
