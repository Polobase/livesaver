import { type DocEntry, navigationOf } from '~/utils/navigation'

/** Every doc by its route, with its title and what it is about: for the lists of the site. */
export function useDocs() {
  return useAsyncData(
    'docs',
    async (): Promise<DocEntry[]> => {
      const docs = await queryCollection('docs').select('path', 'title', 'description').all()
      return docs.map(({ path, title, description }) => ({ path, title, description }))
    },
    { default: () => [] },
  )
}

/** The docs as a list of sections and pages, with the page one is on marked. */
export function useDocsNavigation() {
  const route = useRoute()
  const { data: docs } = useDocs()
  // A static host serves a page with a slash at its end; the docs are known without.
  return computed(() => navigationOf(docs.value, route.path.replace(/\/+$/, '')))
}

/** The web app, which lies beside the site (it is another set of files, not a page of this one). */
export const useAppUrl = () => `${useRuntimeConfig().app.baseURL}app/`
