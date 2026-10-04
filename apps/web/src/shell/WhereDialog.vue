<script setup lang="ts">
/**
 * Where the app runs, which decides what it can do: served by livesaver on this computer,
 * connected to it from a page of another site, or on its own in the browser. And how a page on
 * its own gets to fix: the two ways there are, each said for the browser at hand.
 */
import { computed, ref } from 'vue'
import CopyText from '../components/common/CopyText.vue'
import { connectWith, disconnect } from '../engine/create'
import { GET_LIVESAVER } from '../lib/links'
import { browserFacts, waysOf } from '../lib/ways'
import { useEngineStore } from '../stores/engine'
import { useWritingStore } from '../stores/writing'

const open = defineModel<boolean>('open', { required: true })
const engines = useEngineStore()
const writing = useWritingStore()

const state = computed(() =>
  engines.kind === 'browser' ? 'alone' : engines.paired ? 'paired' : 'served',
)
const site = computed(() => window.location.origin)
const ways = computed(() => waysOf(browserFacts()))

/** The link that `livesaver web --pair` printed, for a tab that it did not open itself. */
const link = ref('')
const refused = ref(false)
function connect(): void {
  refused.value = !connectWith(link.value)
}
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
    :ui="{ content: 'sm:max-w-xl' }"
  >
    <template #body>
      <div class="space-y-4 text-sm" data-testid="where-dialog">
        <template v-if="state === 'alone'">
          <p v-if="engines.capabilities.fix" data-testid="where-writing">
            The page reads the folders you give it, and fixes samples and upgrades plug-ins in the
            project folders you chose for editing (an experiment you switched on in the Settings).
            It scans samples and plug-ins, and shows everything a scan finds.
          </p>
          <p v-else>
            The page reads the folders you give it and changes nothing. It scans samples and
            plug-ins, and shows everything a scan finds. To fix from here, there are two ways.
          </p>

          <section
            class="space-y-3 rounded-lg border border-default p-3"
            aria-labelledby="way-connect-title"
            data-testid="way-connect"
          >
            <div>
              <h3
                id="way-connect-title"
                class="flex items-center gap-2 font-medium text-highlighted"
              >
                <UIcon name="i-lucide-monitor" class="size-4 shrink-0" />
                With livesaver on your computer
              </h3>
              <p class="text-muted">
                Everything: fix, undo, history, the plug-ins that are installed, upgrades.
              </p>
            </div>
            <!-- Two ways that stand side by side, not steps: hence no numbers. -->
            <p>
              Run <CopyText text="livesaver web" what="the command" /> in a terminal. It opens this
              app from your own computer, with livesaver behind it: in every browser, with nothing
              to allow.
            </p>
            <p v-if="ways.connect.state === 'no'" data-testid="connect-way">
              {{ ways.connect.text }}
            </p>
            <p v-else data-testid="connect-way">
              Or connect this page:
              <CopyText text="livesaver web --pair" what="the command" />
              opens it connected.
              {{ ways.connect.text }}
              <template v-if="ways.connect.address">
                <span class="mt-1 block">
                  The setting:
                  <CopyText :text="ways.connect.address" what="the address of the setting" />
                </span>
                <span class="mt-1 block">
                  This site: <CopyText :text="site" what="the address of this site" />
                </span>
              </template>
            </p>
            <form
              v-if="ways.connect.state !== 'no'"
              class="flex items-start gap-2"
              @submit.prevent="connect"
            >
              <UFormField
                class="min-w-0 flex-1"
                size="sm"
                label="Already running? Paste the link that “livesaver web --pair” printed"
                :error="
                  refused
                    ? 'This is not that link: it has “#/connect?at=” in it. Copy it whole from the terminal.'
                    : undefined
                "
              >
                <UInput
                  v-model="link"
                  class="w-full"
                  placeholder="https://…/#/connect?at=…"
                  autocomplete="off"
                  spellcheck="false"
                  data-testid="pairing-link"
                  @update:model-value="refused = false"
                />
              </UFormField>
              <!-- (The label of the field takes a line: the button stands beside the field.) -->
              <UButton
                type="submit"
                size="sm"
                class="mt-6"
                color="neutral"
                variant="subtle"
                icon="i-lucide-link"
                label="Connect"
                :disabled="!link.trim()"
                data-testid="pairing-connect"
              />
            </form>
            <UButton v-bind="GET_LIVESAVER" size="sm" color="neutral" variant="subtle" />
          </section>

          <section
            class="space-y-3 rounded-lg border border-default p-3"
            aria-labelledby="way-edit-title"
            data-testid="way-edit"
          >
            <div>
              <h3 id="way-edit-title" class="flex items-center gap-2 font-medium text-highlighted">
                <UIcon name="i-lucide-globe" class="size-4 shrink-0" />
                On its own, in this browser
              </h3>
              <p class="text-muted">
                An experiment, with limits that livesaver on your computer does not have.
              </p>
            </div>
            <p data-testid="edit-way">
              {{ ways.edit.text }}
              <template v-if="ways.edit.state === 'works'">
                {{
                  writing.on
                    ? 'It is switched on: drop your project folder on the page (or add it with “Add folder”), scan, then review and fix.'
                    : 'It is off until you switch it on, after reading what a page cannot do.'
                }}
              </template>
              <template v-else-if="ways.edit.address">
                Then switch it on in the Settings of this page.
                <span class="mt-1 block">
                  The flag: <CopyText :text="ways.edit.address" what="the address of the flag" />
                </span>
              </template>
            </p>
            <UButton
              v-if="ways.edit.state === 'works' && !writing.on"
              to="/settings"
              size="sm"
              color="neutral"
              variant="subtle"
              icon="i-lucide-settings"
              label="Switch it on in the Settings"
              @click="open = false"
            />
          </section>
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
