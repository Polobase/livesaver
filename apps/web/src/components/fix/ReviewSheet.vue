<script setup lang="ts">
/**
 * Nothing is written without a review: what a fix will do, whether everything is ready for it,
 * then the fix itself and what it did. The fix does what the scan found, also if the page was
 * changed since.
 */
import { computed, ref, watch } from 'vue'
import { bytes, count, plural } from '../../lib/format'
import { fits } from '../../lib/plan'
import { useEngineStore } from '../../stores/engine'
import { useFixStore } from '../../stores/fix'
import { useScanStore } from '../../stores/scan'
import ScrollRegion from '../common/ScrollRegion.vue'
import ScanProgress from '../scan/ScanProgress.vue'

const engines = useEngineStore()
const fix = useFixStore()
const scans = useScanStore()

const STEPS = [
  { title: 'What will happen', icon: 'i-lucide-list-checks' },
  { title: 'Ready?', icon: 'i-lucide-shield-check' },
  { title: 'Fix', icon: 'i-lucide-wrench' },
]
const step = ref(0)
const open = computed({
  get: () => fix.review !== undefined,
  set: (value) => {
    if (!value) fix.close()
  },
})
// A review starts at its first step, each time.
watch(
  () => fix.review !== undefined,
  (isOpen) => {
    if (isOpen) step.value = 0
  },
)

const plan = computed(() => fix.plan)
/** The uncertain matches of the projects in question, whether they are left out or not. */
const uncertain = computed(() => {
  const roots = fix.review?.roots ? new Set(fix.review.roots) : undefined
  return (scans.scan?.samples.projectRows ?? [])
    .filter((row) => !roots || roots.has(row.root))
    .reduce((n, row) => n + row.uncertain, 0)
})
/** A list that fits without scrolling: the projects with the most to fix, the rest as a number. */
const shownProjects = computed(() => {
  const sets = (row: { changingSets: number; certain: { changingSets: number } }) =>
    fix.review?.certainOnly ? row.certain.changingSets : row.changingSets
  return [...(plan.value?.projects ?? [])].sort((a, b) => sets(b) - sets(a)).slice(0, 5)
})
const scope = computed(() => {
  const projects = plan.value?.projects ?? []
  if (!fix.review?.roots) return 'All projects'
  return projects.length === 1 ? `"${projects[0]?.path}"` : plural(projects.length, 'project')
})
const liveRunning = computed(() => fix.status?.liveRunning ?? false)
const room = computed(() => (plan.value ? fits(plan.value, fix.status?.freeBytes) : undefined))
const ready = computed(
  () => Boolean(plan.value && plan.value.sets > 0) && !liveRunning.value && room.value !== false,
)
const done = computed(() => !fix.running && (fix.fixed !== undefined || fix.failure !== undefined))

async function apply(): Promise<void> {
  step.value = 2
  await fix.apply()
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="`Fix ${scope.toLowerCase() === 'all projects' ? 'all projects' : scope}`"
    :description="
      step === 2 ? 'What the fix did.' : 'Review what will change before anything is written.'
    "
    :dismissible="!fix.running"
    :close="!fix.running"
    :ui="{ content: 'sm:max-w-2xl', body: 'flex min-h-0 flex-col overflow-hidden p-0 sm:p-0' }"
  >
    <template #body>
      <ScrollRegion label="The fix, step by step" class="space-y-5 p-4 sm:p-6">
        <UStepper v-model="step" :items="STEPS" size="sm" disabled class="w-full" />

        <!-- 1. What will happen -->
        <div v-if="step === 0 && plan" class="space-y-4" data-testid="review-plan">
          <dl class="grid grid-cols-3 gap-3 text-center">
            <div class="rounded-lg bg-elevated/60 p-3">
              <dd class="tabular text-2xl font-semibold text-highlighted" data-testid="plan-sets">
                {{ count(plan.sets) }}
              </dd>
              <dt class="text-sm text-muted">{{ plan.sets === 1 ? 'set' : 'sets' }} rewritten</dt>
            </div>
            <div class="rounded-lg bg-elevated/60 p-3">
              <dd class="tabular text-2xl font-semibold text-highlighted">
                {{ count(plan.changes) }}
              </dd>
              <dt class="text-sm text-muted">
                {{ plan.changes === 1 ? 'reference' : 'references' }} repointed
              </dt>
            </div>
            <div class="rounded-lg bg-elevated/60 p-3">
              <dd class="tabular text-2xl font-semibold text-highlighted" data-testid="plan-files">
                {{ count(plan.copyFiles) }}
              </dd>
              <dt class="text-sm text-muted">
                {{ plan.copyFiles === 1 ? 'file' : 'files' }} copied<template v-if="plan.copyFiles">
                  · {{ bytes(plan.copyBytes) }}</template
                >
              </dt>
            </div>
          </dl>

          <ul
            v-if="plan.projects.length > 1"
            class="divide-y divide-default rounded-lg border border-default text-sm"
            aria-label="Projects that are fixed"
          >
            <li
              v-for="project in shownProjects"
              :key="project.root"
              class="flex items-center justify-between gap-4 px-3 py-1.5"
            >
              <span class="min-w-0 truncate" :title="project.path">{{ project.path }}</span>
              <span class="tabular shrink-0 text-muted">
                {{
                  plural(
                    fix.review?.certainOnly ? project.certain.changingSets : project.changingSets,
                    'set',
                  )
                }}
              </span>
            </li>
            <li v-if="plan.projects.length > shownProjects.length" class="px-3 py-1.5 text-muted">
              and {{ plural(plan.projects.length - shownProjects.length, 'more project') }}
            </li>
          </ul>

          <USwitch
            v-if="uncertain > 0 && fix.review"
            v-model="fix.review.certainOnly"
            :label="`Leave out the ${plural(uncertain, 'uncertain match', 'uncertain matches')}`"
            description="An uncertain match is a file found by its name and place whose fingerprint does not confirm it. Left out, those samples stay missing; you can listen and decide later."
            data-testid="certain-only"
          />

          <ul class="space-y-1.5 text-sm text-muted">
            <li class="flex gap-2">
              <UIcon name="i-lucide-archive" class="mt-0.5 size-4 shrink-0" />
              Every set as it was is kept in the Backup folder of its project.
            </li>
            <li class="flex gap-2">
              <UIcon name="i-lucide-undo-2" class="mt-0.5 size-4 shrink-0" />
              The whole fix can be undone afterwards.
            </li>
            <li v-if="plan.missing" class="flex gap-2">
              <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-4 shrink-0" />
              {{ plural(plan.missing, 'reference') }} in these projects
              {{ plan.missing === 1 ? 'stays' : 'stay' }} missing: a fix cannot find what is not in
              the folders that were searched.
            </li>
            <li v-if="scans.stale" class="flex gap-2" role="note">
              <UIcon name="i-lucide-refresh-cw" class="mt-0.5 size-4 shrink-0" />
              You changed folders or options after the scan. The fix does what the scan found.
            </li>
          </ul>
        </div>

        <!-- 2. Ready? -->
        <ul v-if="step === 1 && plan" class="space-y-3" data-testid="review-ready">
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
                    @click="fix.refreshStatus()"
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
              :name="room === false ? 'i-lucide-circle-x' : 'i-lucide-circle-check'"
              class="mt-0.5 size-5 shrink-0"
              :class="room === false ? 'text-(--status-missing)' : 'text-(--status-fine)'"
            />
            <div>
              <p class="font-medium text-highlighted">
                {{ room === false ? 'Not enough free space' : 'Enough free space' }}
              </p>
              <p class="text-sm text-muted">
                The copies need {{ bytes(plan.copyBytes)
                }}<template v-if="fix.status?.freeBytes !== undefined"
                  >; {{ bytes(fix.status.freeBytes) }} are free where your projects lie</template
                >.
              </p>
            </div>
          </li>
          <li class="flex gap-3">
            <UIcon
              name="i-lucide-circle-check"
              class="mt-0.5 size-5 shrink-0 text-(--status-fine)"
            />
            <div>
              <p class="font-medium text-highlighted">Backups and undo</p>
              <p class="text-sm text-muted">
                Each set is copied to its project's Backup folder before it is rewritten, as Live
                does. livesaver keeps the originals too, so the fix can be undone even after Live
                has thinned out its backups.
              </p>
            </div>
          </li>
        </ul>

        <!-- 3. Fix -->
        <div v-if="step === 2" class="space-y-4" data-testid="review-fix">
          <ScanProgress v-if="fix.running" :progress="fix.progress" title="Fixing" />
          <UAlert
            v-else-if="fix.fixed"
            color="neutral"
            variant="subtle"
            :icon="fix.fixed.errors.length ? 'i-lucide-triangle-alert' : 'i-lucide-circle-check'"
            :ui="{ icon: fix.fixed.errors.length ? 'text-(--status-missing)' : 'text-(--status-fine)' }"
            :title="`Fixed: ${plural(fix.fixed.sets, 'set')} rewritten, ${plural(fix.fixed.files, 'file')} copied${fix.fixed.bytes ? ` (${bytes(fix.fixed.bytes)})` : ''}.`"
            :description="
            fix.fixed.errors.length
              ? `${plural(fix.fixed.errors.length, 'set')} could not be written; the overview lists them.`
              : 'The scan was renewed: the overview shows what is left.'
          "
            role="status"
          />
          <UAlert
            v-else-if="fix.failure"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-x"
            title="The fix did not work"
            :description="fix.failure.message"
            role="alert"
          />
          <ScanProgress
            v-if="!fix.running && scans.running"
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
            @click="fix.close()"
          />
          <UButton
            v-if="step === 0"
            trailing-icon="i-lucide-arrow-right"
            label="Continue"
            :disabled="!plan || plan.sets === 0"
            data-testid="review-continue"
            @click="
              () => {
                step = 1
                void fix.refreshStatus()
              }
            "
          />
          <UButton
            v-if="step === 1 && plan"
            icon="i-lucide-wrench"
            :label="`Fix ${plural(plan.sets, 'set')}`"
            :disabled="!ready"
            data-testid="review-apply"
            @click="apply"
          />
          <template v-if="step === 2 && done">
            <UButton
              v-if="fix.fixed?.run && engines.capabilities.undo"
              color="neutral"
              variant="subtle"
              icon="i-lucide-undo-2"
              label="Undo this fix"
              :loading="fix.undoing"
              :disabled="scans.running"
              @click="
                async () => {
                  const run = fix.fixed?.run ?? ''
                  fix.close()
                  await fix.undo(run)
                }
              "
            />
            <UButton label="Done" data-testid="review-done" @click="fix.close()" />
          </template>
        </div>
      </div>
    </template>
  </UModal>
</template>
