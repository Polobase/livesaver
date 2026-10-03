<script setup lang="ts">
/** One run in full: what it was asked, how it ended, its reports, and every step it took. */
import { computed, ref, watch } from 'vue'
import type { Run, RunDetail } from '../../engine/types'
import { download, REPORT_TITLES } from '../../lib/download'
import { count, moment, plural } from '../../lib/format'
import {
  commandOf,
  optionFacts,
  outcomeFacts,
  runLook,
  STATE_NOTE,
  STEP_LABEL,
  startedAt,
  undoneLabel,
} from '../../lib/runs'
import { useEngineStore } from '../../stores/engine'
import { useHistoryStore } from '../../stores/history'
import ScrollRegion from '../common/ScrollRegion.vue'

const props = defineProps<{ run?: Run }>()
const emit = defineEmits<{ close: []; undo: [] }>()
const engines = useEngineStore()
const history = useHistoryStore()
const toast = useToast()

/** Steps listed at first; a run over a whole library has thousands. */
const LISTED = 100

const open = computed({
  get: () => props.run !== undefined,
  set: (value) => {
    if (!value) emit('close')
  },
})
const detail = ref<RunDetail>()
const problem = ref('')
const listed = ref(LISTED)

async function load(id: string | undefined): Promise<void> {
  problem.value = ''
  if (!id) return
  try {
    const loaded = await history.detail(id)
    // Another run was opened meanwhile.
    if (props.run?.id === id) detail.value = loaded
  } catch (error) {
    problem.value = (error as Error).message
  }
}
watch(
  () => props.run?.id,
  (id) => {
    detail.value = undefined
    listed.value = LISTED
    void load(id)
  },
  { immediate: true },
)
// An undo changes what became of each step.
watch(
  () => props.run?.state,
  () => void load(props.run?.id),
)

const title = computed(() => (props.run ? runLook(props.run).title : ''))
const started = computed(() => {
  const at = props.run ? startedAt(props.run) : undefined
  return at ? moment(at) : (props.run?.when ?? '')
})
const targets = computed(() => props.run?.record?.targets ?? [])
const options = computed(() => (props.run ? optionFacts(props.run) : []))
const outcome = computed(() => (props.run ? outcomeFacts(props.run) : []))
const steps = computed(() => detail.value?.steps ?? [])
/** Steps whose place can be shown: what was moved back or to the Trash is no longer there. */
const shows = (step: RunDetail['steps'][number]) =>
  engines.capabilities.reveal &&
  step.finished &&
  !step.undone &&
  (step.op === 'write-set' || step.op === 'copy' || step.op === 'rename')

/** The plan of a run that was applied is what it changed. */
const reportTitle = (name: string) =>
  name === 'changes.csv' && props.run?.applied ? 'Changes' : (REPORT_TITLES[name] ?? name)

async function save(name: string): Promise<void> {
  if (!props.run) return
  try {
    download(name, await history.report(props.run.id, name))
  } catch (error) {
    toast.add({
      title: 'The report could not be read',
      description: (error as Error).message,
      color: 'error',
    })
  }
}

async function reveal(path: string): Promise<void> {
  try {
    await engines.engine().reveal(path)
  } catch (error) {
    toast.add({
      title: 'It could not be shown',
      description: (error as Error).message,
      color: 'error',
    })
  }
}
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="title"
    :description="started ? `Started ${started}` : 'A run of livesaver'"
    :ui="{ content: 'sm:max-w-2xl', body: 'flex min-h-0 flex-col overflow-hidden p-0 sm:p-0' }"
  >
    <template v-if="run" #body>
      <ScrollRegion :label="title" class="space-y-6 p-4 text-sm sm:p-6" data-testid="run-panel">
        <div
          v-if="STATE_NOTE[run.state] || (run.applied && run.canUndo && engines.capabilities.undo)"
          class="flex items-center justify-between gap-3"
        >
          <UBadge
            v-if="STATE_NOTE[run.state]"
            color="neutral"
            variant="subtle"
            icon="i-lucide-undo-2"
            :label="STATE_NOTE[run.state]"
          />
          <span v-else />
          <UButton
            v-if="run.applied && run.canUndo && engines.capabilities.undo"
            size="sm"
            color="neutral"
            variant="subtle"
            icon="i-lucide-undo-2"
            :label="run.state === 'partly-undone' ? 'Undo the rest' : 'Undo this run'"
            :loading="history.undoing === run.id"
            :disabled="history.busy"
            data-testid="run-undo"
            @click="emit('undo')"
          />
        </div>

        <UAlert
          v-if="run.record?.error"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-x"
          title="The run stopped with an error"
          :description="run.record.error"
        />
        <UAlert
          v-else-if="run.unfinished"
          color="neutral"
          variant="outline"
          icon="i-lucide-triangle-alert"
          :ui="{ icon: 'text-(--status-missing)' }"
          :title="`${plural(run.unfinished, 'step')} began and never ended`"
          description="The run was stopped there. Undo takes back what it did until then."
        />

        <section v-if="run.record" aria-labelledby="run-asked">
          <h3 id="run-asked" class="font-semibold text-highlighted">What it was asked</h3>
          <dl class="mt-2 grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5">
            <dt class="text-muted">Command</dt>
            <dd>
              <code class="text-xs">{{ commandOf(run) }}</code>
              <span v-if="!run.applied" class="text-muted"> (a dry run: nothing is written)</span>
            </dd>
            <dt class="text-muted">On</dt>
            <dd>
              <ul>
                <li v-for="target in targets.slice(0, 5)" :key="target" class="break-all">
                  {{ target }}
                </li>
                <li v-if="targets.length > 5" class="text-muted">
                  and {{ count(targets.length - 5) }} more
                </li>
              </ul>
            </dd>
            <template v-for="fact in options" :key="fact.label">
              <dt class="text-muted">{{ fact.label }}</dt>
              <dd>
                <ul>
                  <li v-for="value in fact.values" :key="value" class="break-all">{{ value }}</li>
                </ul>
              </dd>
            </template>
          </dl>
        </section>
        <p v-else class="text-muted">
          An older version of livesaver made this run: it did not note what it was asked.
        </p>

        <section v-if="outcome.length" aria-labelledby="run-outcome">
          <h3 id="run-outcome" class="font-semibold text-highlighted">How it ended</h3>
          <dl class="mt-2 grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5">
            <template v-for="fact in outcome" :key="fact.label">
              <dt class="text-muted">{{ fact.label }}</dt>
              <dd class="tabular">{{ fact.values[0] }}</dd>
            </template>
          </dl>
        </section>

        <section v-if="run.reports.length" aria-labelledby="run-reports">
          <h3 id="run-reports" class="font-semibold text-highlighted">Reports</h3>
          <div class="mt-2 flex flex-wrap gap-2">
            <UButton
              v-for="name in run.reports"
              :key="name"
              size="sm"
              color="neutral"
              variant="subtle"
              icon="i-lucide-download"
              :label="reportTitle(name)"
              :title="name"
              @click="save(name)"
            />
          </div>
        </section>

        <UAlert
          v-if="problem"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-x"
          title="The steps of the run could not be read"
          :description="problem"
          role="alert"
        />
        <section v-else-if="steps.length" aria-labelledby="run-steps">
          <h3 id="run-steps" class="font-semibold text-highlighted">
            What it changed
            <span class="font-normal text-muted">· {{ plural(steps.length, 'step') }}</span>
          </h3>
          <ol
            class="mt-2 divide-y divide-default rounded-lg border border-default"
            data-testid="steps"
          >
            <li v-for="(step, index) in steps.slice(0, listed)" :key="index" class="px-3 py-2">
              <div class="flex items-baseline justify-between gap-3">
                <span class="font-medium text-highlighted">
                  {{ STEP_LABEL[step.op] ?? step.op }}
                </span>
                <span class="shrink-0 text-muted">
                  {{
                    !step.finished
                      ? 'did not finish'
                      : step.undone
                        ? undoneLabel(step.undone, engines.kind)
                        : ''
                  }}
                </span>
              </div>
              <p class="break-all whitespace-pre-line">{{ step.path }}</p>
              <p v-if="step.from" class="break-all text-muted">from {{ step.from }}</p>
              <p v-if="step.backup" class="break-all text-muted">backup: {{ step.backup }}</p>
              <UButton
                v-if="shows(step)"
                size="xs"
                color="neutral"
                variant="link"
                class="p-0 underline"
                label="Show in Finder"
                @click="reveal(step.path)"
              />
            </li>
          </ol>
          <UButton
            v-if="steps.length > listed"
            class="mt-2"
            size="sm"
            color="neutral"
            variant="ghost"
            :label="`Show ${count(Math.min(steps.length - listed, 500))} more of ${count(steps.length)}`"
            @click="listed += 500"
          />
        </section>
        <p v-else-if="detail" class="text-muted">It changed nothing.</p>
        <USkeleton v-else class="h-24" />
      </ScrollRegion>
    </template>
  </USlideover>
</template>
