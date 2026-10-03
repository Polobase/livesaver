import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import HistoryPage from './pages/HistoryPage.vue'
import OverviewPage from './pages/OverviewPage.vue'
import PluginsPage from './pages/PluginsPage.vue'
import SamplesPage from './pages/SamplesPage.vue'
import SettingsPage from './pages/SettingsPage.vue'

/**
 * Hash routes: the app is static files that may lie at any path (GitHub Pages, `livesaver web`),
 * and no server has to know its routes.
 *
 * Every page is part of the first load, not fetched when it is first opened: the app has to go
 * on working when what served it is gone (livesaver was stopped, the site was deployed anew),
 * and say so on whichever page one goes to.
 */
const routes: RouteRecordRaw[] = [
  { path: '/', name: 'overview', component: OverviewPage },
  { path: '/samples', name: 'samples', component: SamplesPage },
  { path: '/plugins', name: 'plugins', component: PluginsPage },
  { path: '/history', name: 'history', component: HistoryPage },
  { path: '/settings', name: 'settings', component: SettingsPage },
  { path: '/:rest(.*)*', redirect: '/' },
]

export const router = createRouter({ history: createWebHashHistory(), routes })
