<script setup lang="ts">
/**
 * Where the app runs, which decides what it can do: served by livesaver on this computer,
 * connected to it from a page of another site, or on its own in the browser. And how to get
 * from the last to the first.
 */
import { computed } from 'vue'
import { disconnect } from '../engine/create'
import { GET_LIVESAVER } from '../lib/links'
import { useEngineStore } from '../stores/engine'

const open = defineModel<boolean>('open', { required: true })
const engines = useEngineStore()

const state = computed(() =>
  engines.kind === 'browser' ? 'alone' : engines.paired ? 'paired' : 'served',
)
const site = computed(() => window.location.origin)
</script>

<template>
  <UModal
    v-model:open="open"
    title="Where this app runs"
    :description="
      state === 'alone'
        ? 'In this browser, on its own.'
        : state === 'paired'
          ? 'In this page, connected to livesaver on this computer.'
          : 'On this computer, served by livesaver.'
    "
    :ui="{ content: 'sm:max-w-lg' }"
  >
    <template #body>
      <div class="space-y-4 text-sm" data-testid="where-dialog">
        <template v-if="state === 'alone'">
          <p>
            The page reads the folders you give it and changes nothing. It scans samples and
            plug-ins, and shows everything a scan finds.
          </p>
          <p>
            To fix, to undo, and to see which plug-ins are installed, the app needs livesaver on
            your computer:
          </p>
          <ol class="list-decimal space-y-2 ps-5">
            <li>
              Run <code class="text-xs">livesaver web</code> in a terminal. It opens this app with
              livesaver behind it, in any browser.
            </li>
            <li>
              Or run <code class="text-xs">livesaver web --pair</code> to connect this page to it.
              Chrome, Edge and Firefox ask whether the page may reach your computer; Safari does not
              allow it.
            </li>
          </ol>
          <UButton v-bind="GET_LIVESAVER" color="neutral" variant="subtle" />
        </template>

        <template v-else-if="state === 'paired'">
          <p>
            The page comes from <span class="font-medium text-highlighted">{{ site }}</span>; your
            files are read and written by livesaver on this computer. Nothing of them is sent to the
            site.
          </p>
          <p class="text-muted">
            The connection lasts as long as this tab and the
            <code class="text-xs">livesaver web</code>
            in your terminal.
          </p>
          <UButton
            color="neutral"
            variant="subtle"
            icon="i-lucide-unplug"
            label="Disconnect, and use this page on its own"
            data-testid="disconnect"
            @click="disconnect()"
          />
        </template>

        <template v-else>
          <p>
            livesaver serves this page (<code class="text-xs">livesaver web</code>), reads your
            folders by their paths, and writes: fix, upgrade, undo. Nothing leaves this computer,
            and only this page can ask livesaver for anything.
          </p>
          <p class="text-muted">It runs until you stop it in the terminal.</p>
        </template>
      </div>
    </template>
  </UModal>
</template>
