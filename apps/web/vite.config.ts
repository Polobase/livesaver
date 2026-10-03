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
      ui: {
        colors: { neutral: 'zinc' },
        alert: {
          compoundVariants: [
            // Red says that something failed: the icon and the frame. The words are in the
            // colour of text, which can be read on the tinted ground (red on red cannot).
            {
              color: 'error',
              variant: 'subtle',
              class: {
                root: 'text-default',
                title: 'text-highlighted',
                description: 'text-default opacity-100',
                icon: 'text-error',
              },
            },
          ],
        },
      },
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
    // The whole app is loaded at once (see `router.ts`), in two files: what comes from
    // libraries, which a new version of the app rarely changes, and the app itself.
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: { codeSplitting: { groups: [{ name: 'vendor', test: /node_modules/ }] } },
    },
  },
})
