/**
 * livesaver's site: the landing page, the guides and the format notes of `docs/`, prerendered to
 * static files. GitHub Pages serves them below `/livesaver/` (`NUXT_APP_BASE_URL`), with the web
 * app beside them at `/livesaver/app/`.
 */
import { fileURLToPath } from 'node:url'

const base = process.env.NUXT_APP_BASE_URL ?? '/'
const docs = fileURLToPath(new URL('../../docs', import.meta.url))

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  modules: ['@nuxt/ui', '@nuxt/content'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  telemetry: false,
  runtimeConfig: {
    public: {
      // Where the site is on the web, for the addresses it has to name in full (the canonical
      // address of a page, the picture a link to it is shown with, the sitemap).
      siteUrl: 'https://polobase.github.io/livesaver',
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      link: [{ rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }],
    },
  },
  // A static host serves a page as a folder, with a slash at its end, and sends a browser that
  // asks without one there. Every link has the slash already, so nobody is sent anywhere.
  //
  // A page is fetched ahead when its link is pointed at, not when the link comes into view:
  // the landing page has dozens of links, and whoever leaves it for the app would cut most of
  // those fetches off half-way.
  experimental: {
    defaults: {
      nuxtLink: {
        trailingSlash: 'append',
        prefetchOn: { visibility: false, interaction: true },
      },
    },
  },
  // The font is part of the build, as in the app, not fetched from a font service.
  ui: { fonts: false },
  // Every icon is part of the build: a static host has no server to ask for one, and the site
  // asks no other.
  icon: {
    provider: 'none',
    // Icons are also named in plain TypeScript (the navigation), which is not looked through
    // unless it is said.
    clientBundle: { scan: { globInclude: ['app/**/*.{vue,ts}'], globExclude: ['node_modules'] } },
  },
  content: {
    build: {
      markdown: {
        highlight: {
          theme: { default: 'github-light', dark: 'github-dark' },
          langs: ['sh', 'ts', 'json', 'xml', 'csv', 'sql', 'yaml'],
        },
      },
    },
  },
  hooks: {
    // The README of a folder is the page of the folder, as on GitHub.
    'content:file:afterParse'(ctx) {
      const path = ctx.content.path
      if (typeof path === 'string' && path.endsWith('/readme'))
        ctx.content.path = path.slice(0, -'/readme'.length)
    },
  },
  nitro: {
    prerender: {
      routes: ['/', '/docs', '/search.json', '/sitemap.xml'],
      crawlLinks: true,
      // A link to a page that is not there fails the build.
      failOnError: true,
      // The web app is linked from every page, but it is not a page of this site: its files
      // are put beside the site's when both are deployed.
      ignore: [
        (path) => /^\/app(\/|$)/.test(path.startsWith(base) ? path.slice(base.length - 1) : path),
      ],
    },
    // The pictures of the guides lie with the guides, so that they show on GitHub as well.
    publicAssets: [{ dir: `${docs}/guide/images`, baseURL: '/docs/guide/images', maxAge: 0 }],
  },
})
