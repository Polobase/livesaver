import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

/**
 * Hash routes: the app is static files that may lie at any path (GitHub Pages, `livesaver web`),
 * and no server has to know its routes.
 */
const routes: RouteRecordRaw[] = [
  { path: '/', name: 'overview', component: () => import('./pages/OverviewPage.vue') },
  { path: '/samples', name: 'samples', component: () => import('./pages/SamplesPage.vue') },
  { path: '/plugins', name: 'plugins', component: () => import('./pages/PluginsPage.vue') },
  { path: '/history', name: 'history', component: () => import('./pages/HistoryPage.vue') },
  { path: '/settings', name: 'settings', component: () => import('./pages/SettingsPage.vue') },
  { path: '/:rest(.*)*', redirect: '/' },
]

export const router = createRouter({ history: createWebHashHistory(), routes })
