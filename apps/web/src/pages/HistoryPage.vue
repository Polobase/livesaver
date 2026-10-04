<script setup lang="ts">
/** Every run livesaver made on this computer: what it did, its reports, and its undo. */
import { computed, onMounted, ref } from 'vue'
import RunPanel from '../components/history/RunPanel.vue'
import RunRow from '../components/history/RunRow.vue'
import UndoConfirm from '../components/history/UndoConfirm.vue'
import type { Run } from '../engine/types'
import { count, plural } from '../lib/format'
import { GET_LIVESAVER } from '../lib/links'
import { byDay, changedSomething, TAKEN_OUT } from '../lib/runs'
import PagePanel from '../shell/PagePanel.vue'
import { useEngineStore } from '../stores/engine'
import { useHistoryStore } from '../stores/history'

/** Runs listed at first; the older ones follow when asked for. */
const LISTED = 50

const engines = useEngineStore()
const history = useHistoryStore()
// Runs made on the command line meanwhile are listed, too.
onMounted(() => history.refresh())

/** A history is mostly looked at for what was changed; plans and reports are runs as well. */
const everything = ref(false)
const listed = ref(LISTED)
const matching = computed(() =>
  everything.value ? history.runs : history.runs.filter(changedSomething),
)
const days = computed(() => byDay(matching.value.slice(0, listed.value)))
const quiet = computed(() => history.runs.length - history.runs.filter(changedSomething).length)

const opened = ref<string>()
const confirming = ref<string>()
/** A run as it is now: an undo changes it while its panel is open. */
const runOf = (id: string | undefined) => history.runs.find((run) => run.id === id)

async function undo(run: Run): Promise<void> {
  confirming.value = undefined
  await history.takeBack(run.id)
}
</script>

<template>
  <PagePanel id="history" title="History">
    <template #actions>
      <USwitch
        v-if="engines.capabilities.history && history.runs.length"
        v-model="everything"
        size="sm"
        label="Runs that changed nothing, too"
        data-testid="all-runs"
      />
    </template>

    <div class="mx-auto w-full max-w-4xl space-y-6">
      <UEmpty
        v-if="!engines.capabilities.history"
        icon="i-lucide-history"
        title="There is no history here"
        description="A page in a browser that only reads changes nothing, so there is nothing to keep and nothing to undo. With “livesaver web” on your computer, every fix and every upgrade is listed here, with its reports and its undo."
        :actions="[{ ...GET_LIVESAVER, color: 'neutral', variant: 'subtle' }]"
        class="my-12"
        data-testid="no-history"
      />
      <template v-else>
        <!-- That livesaver is gone is said above, on every page. -->
        <UAlert
          v-if="history.problem && !engines.problem"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-x"
          :title="history.problem"
          role="alert"
          data-testid="history-problem"
          close
          @update:open="history.problem = ''"
        />
        <UAlert
          v-if="history.undone"
          color="neutral"
          variant="subtle"
          icon="i-lucide-undo-2"
          role="status"
          data-testid="history-undone"
          close
          @update:open="history.undone = undefined"
        >
          <template #title>
            Undone: {{ plural(history.undone.result.restored, 'set') }} restored,
            {{ plural(history.undone.result.trashed, 'file') }}
            {{ TAKEN_OUT[engines.kind]
            }}<template v-if="history.undone.result.kept"
              >, {{ plural(history.undone.result.kept, 'file') }} kept (used by a set that was
              changed since)</template
            >.
          </template>
          <template
            v-if="history.undone.result.changedSince.length || history.undone.result.problems.length"
            #description
          >
            <template v-if="history.undone.result.changedSince.length">
              <p>Changed since the run, and left alone:</p>
              <ul class="list-disc ps-5">
                <li v-for="item in history.undone.result.changedSince.slice(0, 5)" :key="item">
                  {{ item }}
                </li>
              </ul>
            </template>
            <template v-if="history.undone.result.problems.length">
              <p>Problems:</p>
              <ul class="list-disc ps-5">
                <li v-for="item in history.undone.result.problems.slice(0, 5)" :key="item">
                  {{ item }}
                </li>
              </ul>
            </template>
          </template>
        </UAlert>

        <div v-if="!history.loaded" class="space-y-4" aria-busy="true">
          <USkeleton v-for="n in 3" :key="n" class="h-12" />
        </div>
        <!-- Nothing to list because the history could not be read is not "no runs". -->
        <span v-else-if="(history.problem || engines.problem) && history.runs.length === 0" />
        <UEmpty
          v-else-if="matching.length === 0"
          icon="i-lucide-history"
          :title="history.runs.length ? 'Nothing was changed yet' : 'No runs yet'"
          :description="
            history.runs.length
              ? `livesaver has planned and reported ${plural(history.runs.length, 'time')} so far, and written nothing. Switch on “Runs that changed nothing, too” to see those runs.`
              : 'Every fix, upgrade and undo will be listed here, each with its reports.'
          "
          class="my-12"
          data-testid="no-runs"
        />
        <template v-else>
          <p class="text-sm text-muted" data-testid="history-intro">
            What livesaver changed
            {{ engines.kind === 'browser' ? 'from this browser' : 'on this computer' }}, the newest
            first. A run can be undone as long as its sets were not changed since.
            <template v-if="engines.kind === 'browser'">
              To undo, this page needs the project folder of the run, added for editing.
            </template>
            <template v-if="!everything && quiet">
              {{ plural(quiet, 'more run') }}
              only planned or reported.
            </template>
          </p>
          <section v-for="day in days" :key="day.label" :aria-label="day.label">
            <h2 class="text-sm font-medium text-muted">{{ day.label }}</h2>
            <ol class="mt-3">
              <RunRow
                v-for="(run, index) in day.runs"
                :key="run.id"
                :run="run"
                :last="index === day.runs.length - 1"
                @open="opened = run.id"
                @undo="confirming = run.id"
              />
            </ol>
          </section>
          <UButton
            v-if="matching.length > listed"
            color="neutral"
            variant="subtle"
            :label="`Show older runs (${count(matching.length - listed)} more)`"
            @click="listed += LISTED"
          />
        </template>
      </template>
    </div>

    <RunPanel :run="runOf(opened)" @close="opened = undefined" @undo="confirming = opened" />
    <UndoConfirm :run="runOf(confirming)" @close="confirming = undefined" @confirm="undo" />
  </PagePanel>
</template>
