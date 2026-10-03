import { fileURLToPath } from 'node:url'
import ui from '@nuxt/ui/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

/** The workspace packages straight from their sources: no build of them is needed to work on the app. */
const source = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url))

export default defineConfig({
  // Relative URLs and hash routes: the same files run at /livesaver/app/ on GitHub Pages and at /
  // when `livesaver web` serves them.
  base: './',
  plugins: [
    vue(),
    ui({
      ui: { colors: { neutral: 'zinc' } },
      // Every icon is part of the build: the app promises that nothing leaves the computer,
      // and it has to work without a network.
      icon: {
        clientBundle: { scan: { globInclude: ['src/**/*.{vue,ts}'] } },
      },
    }),
  ],
  resolve: {
    alias: {
      '@livesaver/xml': source('xml'),
      '@livesaver/core': source('core'),
      '@livesaver/plugins': source('plugins'),
      '@livesaver/ops': source('ops'),
      '@livesaver/web': source('web'),
    },
  },
  worker: { format: 'es' },
  build: {
    sourcemap: true,
    // Vue and the component library are most of the first chunk; it is loaded once and cached.
    chunkSizeWarningLimit: 800,
  },
})
