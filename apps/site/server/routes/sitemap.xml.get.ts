/** Every page of the site, for search engines. Built once, when the site is generated. */
import { queryCollection } from '@nuxt/content/nitro'

export default defineEventHandler(async (event) => {
  const site = useRuntimeConfig(event).public.siteUrl
  const docs = await queryCollection(event, 'docs').select('path').all()
  const paths = ['', '/docs', ...docs.map((doc) => doc.path).sort(), '/app']
  setHeader(event, 'content-type', 'application/xml; charset=utf-8')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...paths.map((path) => `  <url><loc>${site}${path}/</loc></url>`),
    '</urlset>',
    '',
  ].join('\n')
})
