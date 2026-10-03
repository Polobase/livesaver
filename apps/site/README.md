# livesaver's site

The landing page and the docs, built as static files for GitHub Pages (Nuxt, Nuxt UI, Nuxt
Content). Not published to npm.

- **The pages are the repository's `docs/`.** One source for GitHub and for the site: plain
  Markdown, no front matter, no numbers in file names. A doc's title is its first heading, and
  its first paragraph is what lists and search engines show. The order of the pages is in
  `app/utils/navigation.ts`; a test fails if a doc has no place there.
- **Links and pictures are written as on GitHub** (`fileref.md`, `images/overview-light.webp`),
  relative to their file. The site turns a link to a doc into the doc's page, and a link to a
  file outside `docs/` into its place on GitHub (`app/utils/links.ts`).
- **The pictures of the app** lie in `docs/guide/images` and are taken by `bun screenshots.ts`,
  in light and dark, from a made-up library in a temporary folder: nothing of the computer that
  takes them is in a picture. Run it again when the app looks different.
- **Nothing is fetched from elsewhere**: the font and every icon are part of the build, and the
  search looks through a file that is generated with the site.
- **The web app is not part of the site.** It is built on its own (`apps/web`) and put beside
  the site at `app/` when both are deployed; `serve.ts` does the same for the tests.

```sh
bun run site          # work on it: http://localhost:3000/
bun run site:build    # the static files, for /livesaver/ (apps/site/.output/public)
bun run test:site     # the built site as GitHub Pages serves it, in three browsers
bun test apps/site    # the docs: every one has its place, every link and picture leads somewhere
```
