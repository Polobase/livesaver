<script setup lang="ts">
/**
 * One project, or one of its sets, from the side: its sets, what a fix changes in it (old place
 * → new place) and what stays missing and why.
 */
import { computed } from 'vue'
import type { Scan } from '../../engine/types'
import { olderSaves, projectDetail } from '../../lib/detail'
import { bytes, count, plural } from '../../lib/format'
import {
  ACTION_LABEL,
  missingOf,
  projectHealth,
  setHealth,
  whyLabel,
  whyText,
} from '../../lib/health'
import { absentWords } from '../../lib/library'
import { useEngineStore } from '../../stores/engine'
import { useFixStore } from '../../stores/fix'
import { useLibraryStore } from '../../stores/library'
import { useScanStore } from '../../stores/scan'
import PathText from '../common/PathText.vue'
import RevealLink from '../common/RevealLink.vue'
import ScrollRegion from '../common/ScrollRegion.vue'
import StatusPill from '../common/StatusPill.vue'

const props = defineProps<{ scan: Scan; root?: string; setPath?: string }>()
const emit = defineEmits<{ close: []; changes: [search: string] }>()
const engines = useEngineStore()
const fix = useFixStore()
const library = useLibraryStore()
const scans = useScanStore()
/** Folders of the last visit the scan did not read: what is "not found" may lie in them. */
const notRead = computed(() =>
  library.waiting.length
    ? absentWords(
        library.waiting.map((folder) => folder.name),
        true,
      ).line
    : '',
)

/**
 * Old saves of the project that are not complete, while a newer Live saved it since: a scan
 * can leave such sets out, which is said where they stand in the way.
 */
const older = computed(() =>
  detail.value && !detail.value.set && !library.options.minLive
    ? olderSaves(detail.value.sets)
    : undefined,
)

/** Changes and missing samples listed here; the tabs list them all. */
const LISTED = 30

const open = computed({
  get: () => props.root !== undefined,
  set: (value) => {
    if (!value) emit('close')
  },
})
const detail = computed(() =>
  props.root ? projectDetail(props.scan, props.root, props.setPath) : undefined,
)
const health = computed(() => {
  const d = detail.value
  if (!d) return 'fine'
  return d.set ? setHealth(d.set) : projectHealth(d.project)
})
const title = computed(() => detail.value?.set?.name ?? detail.value?.project.path ?? '')
const where = computed(() => {
  const d = detail.value
  if (!d) return ''
  return d.set ? `In ${d.project.path}` : d.project.root
})
/** What is shown in Finder: the set's file, or the project folder. */
const file = computed(() => {
  const d = detail.value
  if (!d) return ''
  return d.set ? `${d.project.root}/${d.set.path.slice(d.project.path.length + 1)}` : d.project.root
})

function fixIt(): void {
  if (!detail.value) return
  emit('close')
  fix.open([detail.value.project.root])
}
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="title"
    :description="where"
    :ui="{ content: 'sm:max-w-2xl', body: 'flex min-h-0 flex-col overflow-hidden p-0 sm:p-0' }"
  >
    <template v-if="detail" #body>
      <ScrollRegion :label="title" class="space-y-6 p-4 sm:p-6">
        <div class="flex flex-wrap items-center gap-3">
          <StatusPill :health="health" class="font-medium" />
          <div class="ms-auto flex gap-2">
            <RevealLink button :path="file" />
            <UButton
              v-if="engines.capabilities.fix && detail.project.changingSets > 0"
              size="sm"
              icon="i-lucide-list-checks"
              label="Fix this project"
              :disabled="scans.running || fix.running"
              @click="fixIt"
            />
          </div>
        </div>

        <dl v-if="!detail.set" class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div class="rounded-lg bg-elevated/60 p-3">
            <dt class="text-sm text-muted">Sets</dt>
            <dd class="tabular text-xl font-semibold text-highlighted">
              {{ count(detail.project.sets) }}
            </dd>
          </div>
          <div class="rounded-lg bg-elevated/60 p-3">
            <dt class="text-sm text-muted">To fix</dt>
            <dd class="tabular text-xl font-semibold text-highlighted">
              {{ count(detail.project.changes) }}
            </dd>
          </div>
          <div class="rounded-lg bg-elevated/60 p-3">
            <dt class="text-sm text-muted">Stay missing</dt>
            <dd class="tabular text-xl font-semibold text-highlighted">
              {{ count(detail.project.missing) }}
            </dd>
          </div>
          <div class="rounded-lg bg-elevated/60 p-3">
            <dt class="text-sm text-muted">To copy</dt>
            <dd class="tabular text-xl font-semibold text-highlighted">
              {{ detail.project.copyFiles ? bytes(detail.project.copyBytes) : '0' }}
            </dd>
          </div>
        </dl>

        <section v-if="!detail.set" aria-labelledby="panel-sets">
          <h3 id="panel-sets" class="font-semibold text-highlighted">
            {{ plural(detail.sets.length, 'set') }}
          </h3>
          <ul class="mt-2 divide-y divide-default rounded-lg border border-default text-sm">
            <li
              v-for="set in detail.sets"
              :key="set.path"
              class="flex items-center justify-between gap-4 px-3 py-2"
            >
              <span class="min-w-0">
                <span class="block truncate font-medium text-highlighted" :title="set.name">
                  {{ set.name }}
                </span>
                <span class="text-muted">
                  Live {{ set.live || '?' }}
                  <template v-if="set.error"> · {{ set.error }}</template>
                  <template v-else>
                    · {{ count(set.counts.ok + set.counts.kept) }} fine
                    <template v-if="set.changes"> · {{ count(set.changes) }} to fix</template>
                    <template v-if="missingOf(set.counts)">
                      · {{ count(missingOf(set.counts)) }} missing
                    </template>
                  </template>
                </span>
              </span>
              <StatusPill :health="setHealth(set)" class="shrink-0" />
            </li>
          </ul>
          <p v-if="older" class="mt-2 text-sm text-muted" data-testid="older-saves">
            {{
              older.sets === 1
                ? 'One of them is an older save'
                : `${count(older.sets)} of them are older saves`
            }}
            (Live {{ older.live }}) of a project that Live {{ older.newest }} saved since. If you
            keep {{ older.sets === 1 ? 'it' : 'them' }} only as
            {{ older.sets === 1 ? 'it was' : 'they were' }}, a scan can leave such sets out:
            <RouterLink
              :to="{ path: '/', query: { folders: 'open' } }"
              class="text-default underline underline-offset-2"
              >“Leave out sets of older Live versions”</RouterLink
            >, in the folders and options.
          </p>
        </section>
        <p v-else-if="detail.set.error" class="text-sm">
          This set could not be read: {{ detail.set.error }}
        </p>

        <section v-if="detail.changes.length" aria-labelledby="panel-changes">
          <h3 id="panel-changes" class="font-semibold text-highlighted">
            What a fix changes ({{ count(detail.changes.length) }})
          </h3>
          <ul class="mt-2 divide-y divide-default rounded-lg border border-default text-sm">
            <li
              v-for="(change, index) in detail.changes.slice(0, LISTED)"
              :key="index"
              class="space-y-1 px-3 py-2"
            >
              <div class="flex items-baseline justify-between gap-3">
                <span class="min-w-0 truncate font-medium text-highlighted" :title="change.name">
                  {{ change.name }}
                </span>
                <span class="shrink-0 text-muted">
                  {{ ACTION_LABEL[change.action] ?? change.action
                  }}<template v-if="!change.certain"> · uncertain</template>
                </span>
              </div>
              <div class="grid grid-cols-[auto_1fr] gap-x-2 text-muted">
                <span>was</span>
                <PathText :path="change.oldPath" plain />
                <span>now</span>
                <PathText :path="change.newPath" plain class="text-default" />
              </div>
              <p v-if="change.method" class="text-muted">Found by: {{ change.method }}</p>
            </li>
          </ul>
          <UButton
            v-if="detail.changes.length > LISTED"
            class="mt-2 p-0 underline"
            size="sm"
            color="neutral"
            variant="link"
            :label="`See all ${count(detail.changes.length)} under Changes`"
            @click="emit('changes', detail.set?.path ?? detail.project.path)"
          />
        </section>

        <section v-if="detail.missing.length" aria-labelledby="panel-missing">
          <h3 id="panel-missing" class="font-semibold text-highlighted">
            What stays missing ({{ count(detail.missing.length) }})
          </h3>
          <p v-if="notRead" class="mt-1 text-sm" role="note" data-testid="not-read-line">
            <UIcon
              name="i-lucide-triangle-alert"
              class="me-1 inline size-4 align-text-bottom text-(--status-missing)"
            />{{ notRead }}
          </p>
          <ul class="mt-2 divide-y divide-default rounded-lg border border-default text-sm">
            <li
              v-for="row in detail.missing.slice(0, LISTED)"
              :key="`${row.status}:${row.blind}:${row.path}`"
              class="space-y-1 px-3 py-2"
            >
              <div class="flex items-baseline justify-between gap-3">
                <span class="min-w-0 truncate font-medium text-highlighted" :title="row.name">
                  {{ row.name }}
                </span>
                <span class="shrink-0 text-muted">{{ whyLabel(row) }}</span>
              </div>
              <PathText :path="row.path" plain class="text-muted" />
              <p class="text-muted">
                {{ whyText(row) }}
                <template v-if="!row.blind">Came from: {{ row.sourceName }}.</template>
              </p>
            </li>
          </ul>
          <p v-if="detail.missing.length > LISTED" class="mt-2 text-sm text-muted">
            and {{ count(detail.missing.length - LISTED) }} more, under Missing.
          </p>
        </section>

        <p
          v-if="!detail.changes.length && !detail.missing.length && !detail.set?.error"
          class="text-sm text-muted"
        >
          Every sample is where the {{ detail.set ? 'set expects' : 'sets expect' }} it. There is
          nothing to do.
        </p>
      </ScrollRegion>
    </template>
  </USlideover>
</template>
