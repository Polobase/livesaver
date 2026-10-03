<script setup lang="ts">
/** The review before plug-ins are switched to VST3: what changes, whether all is ready, the result. */
import { computed, ref, watch } from 'vue'
import { count, plural } from '../../lib/format'
import { upgradeSum } from '../../lib/upgrade'
import { useEngineStore } from '../../stores/engine'
import { usePluginsStore } from '../../stores/plugins'
import { useScanStore } from '../../stores/scan'
import ScrollRegion from '../common/ScrollRegion.vue'
import ScanProgress from '../scan/ScanProgress.vue'

const engines = useEngineStore()
const plugins = usePluginsStore()
const scans = useScanStore()

const STEPS = [
  { title: 'What will happen', icon: 'i-lucide-list-checks' },
  { title: 'Ready?', icon: 'i-lucide-shield-check' },
  { title: 'Upgrade', icon: 'i-lucide-circle-arrow-up' },
]
const step = ref(0)
const open = computed({
  get: () => plugins.review !== undefined,
  set: (value) => {
    if (!value) plugins.close()
  },
})
watch(
  () => plugins.review !== undefined,
  (isOpen) => {
    if (isOpen) step.value = 0
  },
)

const sum = computed(() =>
  plugins.plan
    ? upgradeSum(
        plugins.plan,
        plugins.chosen.map((plugin) => plugin.plugin),
      )
    : undefined,
)
const liveRunning = computed(() => plugins.status?.liveRunning ?? false)
const done = computed(
  () => !plugins.running && (plugins.upgraded !== undefined || plugins.failure !== undefined),
)

async function apply(): Promise<void> {
  step.value = 2
  await plugins.apply()
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Upgrade plug-ins to VST3"
    :description="
      step === 2 ? 'What the upgrade did.' : 'Review what will change before anything is written.'
    "
    :dismissible="!plugins.running"
    :close="!plugins.running"
    :ui="{ content: 'sm:max-w-2xl', body: 'flex min-h-0 flex-col overflow-hidden p-0 sm:p-0' }"
  >
    <template #body>
      <ScrollRegion label="The upgrade, step by step" class="space-y-5 p-4 sm:p-6">
        <UStepper v-model="step" :items="STEPS" size="sm" disabled class="w-full" />

        <div v-if="step === 0 && sum" class="space-y-4" data-testid="upgrade-plan">
          <dl class="grid grid-cols-2 gap-3 text-center">
            <div class="rounded-lg bg-elevated/60 p-3">
              <dd class="tabular text-2xl font-semibold text-highlighted">{{ count(sum.sets) }}</dd>
              <dt class="text-sm text-muted">
                {{ sum.sets === 1 ? 'set' : 'sets' }} rewritten, in
                {{ plural(sum.projects, 'project') }}
              </dt>
            </div>
            <div class="rounded-lg bg-elevated/60 p-3">
              <dd class="tabular text-2xl font-semibold text-highlighted">
                {{ count(sum.instances) }}
              </dd>
              <dt class="text-sm text-muted">
                {{ sum.instances === 1 ? 'instance' : 'instances' }} switched to VST3
              </dt>
            </div>
          </dl>
          <ul
            class="divide-y divide-default rounded-lg border border-default text-sm"
            aria-label="Plug-ins that are upgraded"
          >
            <li
              v-for="plugin in plugins.chosen"
              :key="plugin.plugin"
              class="flex items-center justify-between gap-4 px-3 py-1.5"
            >
              <span class="min-w-0 truncate font-medium">{{ plugin.plugin }}</span>
              <span class="tabular shrink-0 text-muted">
                {{ plural(plugin.convertibleInstances, 'instance') }}
                in
                {{ plural(plugin.convertibleSets, 'set') }}
              </span>
            </li>
          </ul>
          <ul class="space-y-1.5 text-sm text-muted">
            <li class="flex gap-2">
              <UIcon name="i-lucide-audio-lines" class="mt-0.5 size-4 shrink-0" />
              Each device keeps its sound: the plug-in's state is carried over to its VST3.
            </li>
            <li v-if="sum.selectionsReset" class="flex gap-2">
              <UIcon name="i-lucide-sliders-horizontal" class="mt-0.5 size-4 shrink-0" />
              {{ plural(sum.selectionsReset, 'instance') }}
              {{ sum.selectionsReset === 1 ? 'shows' : 'show' }} the plug-in's default parameters in
              Live afterwards, instead of the ones chosen by hand.
            </li>
            <li class="flex gap-2">
              <UIcon name="i-lucide-archive" class="mt-0.5 size-4 shrink-0" />
              Every set as it was is kept in the Backup folder of its project, and the whole upgrade
              can be undone.
            </li>
          </ul>
        </div>

        <ul v-if="step === 1" class="space-y-3" data-testid="upgrade-ready">
          <li class="flex gap-3">
            <UIcon
              :name="liveRunning ? 'i-lucide-circle-x' : 'i-lucide-circle-check'"
              class="mt-0.5 size-5 shrink-0"
              :class="liveRunning ? 'text-(--status-missing)' : 'text-(--status-fine)'"
            />
            <div>
              <p class="font-medium text-highlighted">
                {{ liveRunning ? 'Ableton Live is running' : 'Ableton Live is closed' }}
              </p>
              <p class="text-sm text-muted">
                <template v-if="liveRunning">
                  Quit it first, so that no open set gets overwritten.
                  <UButton
                    variant="link"
                    color="neutral"
                    size="sm"
                    class="p-0 underline"
                    label="Check again"
                    @click="plugins.refreshStatus()"
                  />
                </template>
                <template v-else
                  >A set that is open in Live must not be rewritten under it.</template
                >
              </p>
            </div>
          </li>
          <li class="flex gap-3">
            <UIcon
              name="i-lucide-circle-check"
              class="mt-0.5 size-5 shrink-0 text-(--status-fine)"
            />
            <div>
              <p class="font-medium text-highlighted">Check it in Live afterwards</p>
              <p class="text-sm text-muted">
                Open an upgraded set and listen. If something is not as it was, the undo brings
                every set back exactly.
              </p>
            </div>
          </li>
        </ul>

        <div v-if="step === 2" class="space-y-4" data-testid="upgrade-result">
          <ScanProgress v-if="plugins.running" :progress="plugins.progress" title="Upgrading" />
          <UAlert
            v-else-if="plugins.upgraded"
            color="neutral"
            variant="subtle"
            :icon="plugins.upgraded.errors.length ? 'i-lucide-triangle-alert' : 'i-lucide-circle-check'"
            :ui="{
              icon: plugins.upgraded.errors.length ? 'text-(--status-missing)' : 'text-(--status-fine)',
            }"
            :title="`Upgraded: ${plural(plugins.upgraded.sets, 'set')} rewritten.`"
            :description="
              plugins.upgraded.errors.length
                ? `${plural(plugins.upgraded.errors.length, 'set')} could not be written: ${plugins.upgraded.errors[0]?.error}`
                : 'The sets were scanned again.'
            "
            role="status"
          />
          <UAlert
            v-else-if="plugins.failure"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-x"
            title="The upgrade did not work"
            :description="plugins.failure.message"
            role="alert"
          />
          <ScanProgress
            v-if="!plugins.running && scans.running"
            :progress="scans.progress"
            title="Scanning again"
          />
        </div>
      </ScrollRegion>
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-between gap-2">
        <UButton
          v-if="step === 1"
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-left"
          label="Back"
          @click="step = 0"
        />
        <span v-else />
        <div class="flex gap-2">
          <UButton
            v-if="step < 2"
            color="neutral"
            variant="ghost"
            label="Cancel"
            @click="plugins.close()"
          />
          <UButton
            v-if="step === 0"
            trailing-icon="i-lucide-arrow-right"
            label="Continue"
            :disabled="!sum || sum.sets === 0"
            data-testid="upgrade-continue"
            @click="
              () => {
                step = 1
                void plugins.refreshStatus()
              }
            "
          />
          <UButton
            v-if="step === 1 && sum"
            icon="i-lucide-circle-arrow-up"
            :label="`Upgrade ${plural(sum.sets, 'set')}`"
            :disabled="liveRunning"
            data-testid="upgrade-apply"
            @click="apply"
          />
          <template v-if="step === 2 && done">
            <UButton
              v-if="plugins.upgraded?.run && engines.capabilities.undo"
              color="neutral"
              variant="subtle"
              icon="i-lucide-undo-2"
              label="Undo this upgrade"
              :loading="plugins.undoing"
              :disabled="scans.running || plugins.planning"
              @click="
                async () => {
                  const run = plugins.upgraded?.run ?? ''
                  plugins.close()
                  await plugins.undo(run)
                }
              "
            />
            <UButton label="Done" data-testid="upgrade-done" @click="plugins.close()" />
          </template>
        </div>
      </div>
    </template>
  </UModal>
</template>
