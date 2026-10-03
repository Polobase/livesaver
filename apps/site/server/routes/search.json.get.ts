/**
 * What the search of the site looks through: every section of every doc. Built once, when the
 * site is generated, and fetched when the search is first opened.
 */
import { queryCollectionSearchSections } from '@nuxt/content/nitro'

export default defineEventHandler((event) => queryCollectionSearchSections(event, 'docs'))
