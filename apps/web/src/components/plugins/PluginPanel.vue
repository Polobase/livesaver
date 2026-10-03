<script setup lang="ts">
/**
 * One plug-in from the side: a plug-in the sets use (where, what Live finds, what to do), or an
 * installed one (where it lies, and what breaks if it is uninstalled).
 */
import { type InstalledRow, type PluginUseRow, uninstallView } from '@livesaver/ops'
import { computed } from 'vue'
import type { Scan } from '../../engine/types'
import { count, plural } from '../../lib/format'
import { canUpgrade, pluginAdvice } from '../../lib/plugins'
import ScrollRegion from '../common/ScrollRegion.vue'
import PluginPill from './PluginPill.vue'

const props = defineProps<{ scan: Scan; use?: PluginUseRow; installed?: InstalledRow }>()
const emit = defineEmits<{ close: []; upgrade: [] }>()

const LISTED = 40
const open = computed({
  get: () => props.use !== undefined || props.installed !== undefined,
  set: (value) => {
    if (!value) emit('close')
  },
})
const title = computed(() => props.use?.name || props.installed?.name || '(no name)')
const subtitle = computed(() => {
  const of = props.use ?? props.installed
  if (!of) return ''
  return of.format === 'VST2' ? `VST2 · ${of.code}` : `${of.format} · ${of.ident}`
})
/** What would break if every installed plug-in of this name were removed. */
const uninstall = computed(() =>
  props.installed ? uninstallView(props.scan.plugins, props.installed.name) : undefined,
)
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="title"
    :description="subtitle"
    :ui="{ content: 'sm:max-w-xl', body: 'flex min-h-0 flex-col overflow-hidden p-0 sm:p-0' }"
  >
    <template v-if="use" #body>
      <ScrollRegion :label="title" class="space-y-6 p-4 text-sm sm:p-6">
        <div class="flex flex-wrap items-center gap-3">
          <PluginPill :state="use.state" class="text-base font-medium" />
          <UButton
            v-if="canUpgrade(use)"
            class="ms-auto"
            size="sm"
            icon="i-lucide-arrow-up-circle"
            label="Go to Upgrade"
            @click="emit('upgrade')"
          />
        </div>
        <ul class="space-y-2" data-testid="plugin-advice">
          <li v-for="line in pluginAdvice(use)" :key="line">{{ line }}</li>
        </ul>

        <section aria-labelledby="plugin-sets">
          <h3 id="plugin-sets" class="font-semibold text-highlighted">
            Used {{ plural(use.instances, 'time') }} in {{ plural(use.sets.length, 'set') }}
          </h3>
          <ul class="mt-2 divide-y divide-default rounded-lg border border-default">
            <li v-for="set in use.sets.slice(0, LISTED)" :key="set" class="break-all px-3 py-1.5">
              {{ set }}
            </li>
            <li v-if="use.sets.length > LISTED" class="px-3 py-1.5 text-muted">
              and {{ count(use.sets.length - LISTED) }} more
            </li>
          </ul>
        </section>

        <section v-if="use.installedAt.length" aria-labelledby="plugin-at">
          <h3 id="plugin-at" class="font-semibold text-highlighted">Installed at</h3>
          <ul class="mt-2 space-y-1 text-muted">
            <li v-for="path in use.installedAt" :key="path" class="break-all">{{ path }}</li>
          </ul>
        </section>

        <section v-if="use.alternatives.length" aria-labelledby="plugin-other">
          <h3 id="plugin-other" class="font-semibold text-highlighted">
            The same plug-in in other formats
          </h3>
          <ul class="mt-2 divide-y divide-default rounded-lg border border-default">
            <li
              v-for="other in use.alternatives"
              :key="`${other.format}:${other.ident}`"
              class="flex items-baseline justify-between gap-3 px-3 py-1.5"
            >
              <span class="min-w-0 truncate">{{ other.format }} · {{ other.name }}</span>
              <span class="shrink-0 text-muted">
                {{ other.native ? 'runs natively' : 'Rosetta only'
                }}<template v-if="other.link === 'name'"> · same name only</template>
              </span>
            </li>
          </ul>
        </section>
      </ScrollRegion>
    </template>

    <template v-else-if="installed && uninstall" #body>
      <ScrollRegion :label="title" class="space-y-6 p-4 text-sm sm:p-6">
        <dl class="grid grid-cols-[9rem_1fr] gap-y-1.5">
          <dt class="text-muted">Runs</dt>
          <dd>{{ installed.native ? 'natively' : 'only under Rosetta (Intel code)' }}</dd>
          <template v-if="installed.version">
            <dt class="text-muted">Version</dt>
            <dd>{{ installed.version }}</dd>
          </template>
          <dt class="text-muted">Known to Live</dt>
          <dd>{{ installed.scanned ? 'yes' : 'no: Live has not scanned it' }}</dd>
          <dt class="text-muted">Used by</dt>
          <dd>
            {{ plural(installed.usedBySets, 'set') }} in this format<template
              v-if="!installed.usedBySets && !installed.unused"
              >; the sets use it in another format</template
            >
          </dd>
        </dl>

        <section aria-labelledby="plugin-paths">
          <h3 id="plugin-paths" class="font-semibold text-highlighted">Where it lies</h3>
          <ul class="mt-2 space-y-1 text-muted">
            <li v-for="path in installed.paths" :key="path" class="break-all">{{ path }}</li>
            <li v-if="installed.paths.length === 0">Registered with the system, no file known.</li>
          </ul>
        </section>

        <section aria-labelledby="plugin-uninstall" data-testid="uninstall">
          <h3 id="plugin-uninstall" class="font-semibold text-highlighted">If you uninstall it</h3>
          <p class="mt-1 text-muted">
            Counted for every installed plug-in of this name, in
            {{ plural(uninstall.removes.length, 'format') }}
            ({{ uninstall.removes.map((plugin) => plugin.format).join(', ') }}).
          </p>
          <p v-if="uninstall.breaks.length === 0" class="mt-2">
            Nothing breaks: no set relies on it.
          </p>
          <template v-else>
            <p class="mt-2">
              {{ plural(uninstall.sets.length, 'set') }} in
              {{ plural(uninstall.projects.length, 'project') }} would open with a placeholder
              instead of it.
            </p>
            <ul class="mt-2 divide-y divide-default rounded-lg border border-default">
              <li
                v-for="set in uninstall.sets.slice(0, LISTED)"
                :key="set"
                class="break-all px-3 py-1.5"
              >
                {{ set }}
              </li>
              <li v-if="uninstall.sets.length > LISTED" class="px-3 py-1.5 text-muted">
                and {{ count(uninstall.sets.length - LISTED) }} more
              </li>
            </ul>
          </template>
        </section>
      </ScrollRegion>
    </template>
  </USlideover>
</template>
