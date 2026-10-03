<script setup lang="ts" generic="T extends object">
/**
 * A table for thousands of rows: only the rows in view are in the page, the header stays, and a
 * click on a header sorts. Every row is one line high, which is what lets rows be skipped; what
 * does not fit in a line is shown when the row is opened.
 */
import type { TableColumn, TableRow } from '@nuxt/ui'
import { computed, useTemplateRef, watch } from 'vue'

/** The columns the rows are sorted by, the first one first. */
export type Sorting = { id: string; desc: boolean }[]

export interface Column<Row> {
  readonly id: string
  readonly label: string
  /** The value a click on the header sorts by; without it the column does not sort. */
  readonly sort?: (row: Row) => string | number
  readonly numeric?: boolean
  /** Classes of the column's cells: its width, mostly. */
  readonly class?: string
  /** The label is for assistive technology only (a column of buttons that say what they do). */
  readonly quiet?: boolean
}

const props = defineProps<{
  rows: readonly T[]
  columns: readonly Column<T>[]
  rowId: (row: T) => string
  /** What a row is called where it has to be named (the tick box of a row). */
  rowLabel?: (row: T) => string
  /** What the table lists, for assistive technology. */
  caption: string
  empty?: string
  /** Rows can be ticked. */
  selectable?: boolean
  /** A row can be opened (by click, Enter or Space). */
  openable?: boolean
  /** Which rows can be ticked (all, if not given). */
  canSelect?: (row: T) => boolean
}>()
const emit = defineEmits<{ open: [row: T] }>()
const sorting = defineModel<Sorting>('sorting', { default: () => [] })
const selected = defineModel<Record<string, boolean>>('selected', { default: () => ({}) })

const ROW_HEIGHT = 41

// A list in a new order is read from its top, not from where the old one was scrolled to.
const table = useTemplateRef<{ $el?: HTMLElement }>('table')
watch(sorting, () => table.value?.$el?.scrollTo({ top: 0 }))

const defs = computed<TableColumn<T>[]>(() => [
  ...(props.selectable
    ? [
        {
          id: 'select',
          enableSorting: false,
          meta: { class: { th: 'w-10', td: 'w-10' } },
        } satisfies TableColumn<T>,
      ]
    : []),
  ...props.columns.map(
    (column): TableColumn<T> => ({
      id: column.id,
      header: column.label,
      accessorFn: (row) => column.sort?.(row) ?? '',
      enableSorting: Boolean(column.sort),
      sortUndefined: 'last',
      meta: {
        class: {
          th: [column.numeric ? 'text-end' : '', column.class ?? ''].join(' '),
          td: [column.numeric ? 'text-end tabular' : '', column.class ?? ''].join(' '),
        },
      },
    }),
  ),
])

const SORT_ICON = {
  asc: 'i-lucide-arrow-up',
  desc: 'i-lucide-arrow-down',
  none: 'i-lucide-chevrons-up-down',
} as const

/** The arrow keys move between the rows, as in a list. */
function move(event: KeyboardEvent): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const row = event.target as HTMLElement
  if (row.tagName !== 'TR' || !row.closest('tbody')) return
  const next = event.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling
  // Not every row can take the focus: rows that only hold the place of rows out of view cannot.
  if (!(next instanceof HTMLElement) || next.tabIndex < 0) return
  event.preventDefault()
  next.focus()
}

function open(event: Event, row: TableRow<T>): void {
  // A tick, a button or a link in the row is its own action.
  if ((event.target as HTMLElement).closest('button, a, [role=checkbox], input')) return
  emit('open', row.original)
}
</script>

<template>
  <UTable
    ref="table"
    v-model:sorting="sorting"
    v-model:row-selection="selected"
    :data="rows as T[]"
    :columns="defs"
    :get-row-id="rowId"
    :row-selection-options="{
      enableRowSelection: (row: TableRow<T>) => canSelect?.(row.original) ?? true,
    }"
    :caption="caption"
    :empty="empty ?? 'Nothing matches.'"
    :virtualize="{ estimateSize: ROW_HEIGHT, overscan: 16 }"
    :watch-options="{ deep: false }"
    sticky="header"
    class="min-h-0 flex-1"
    :ui="{
      // Opaque: rows that scroll under a see-through header shine through it as a blur.
      thead: 'bg-default backdrop-blur-none',
      th: 'px-4 py-2.5 whitespace-nowrap',
      td: 'px-4 py-0 h-[41px] max-w-0 text-default',
      // A row that takes the focus scrolls into view below the header that stays, not under it.
      tbody: openable
        ? '[&>tr]:cursor-pointer [&>tr]:hover:bg-elevated/50 [&>tr]:focus-visible:outline-3 [&>tr]:outline-primary/25 [&>tr]:-outline-offset-3 [&>tr]:scroll-mt-11 divide-y divide-default'
        : 'divide-y divide-default',
    }"
    v-bind="openable ? { onSelect: open } : {}"
    @keydown="move"
  >
    <template v-if="selectable" #select-header="{ table }">
      <UCheckbox
        :model-value="
          table.getIsSomeRowsSelected() ? 'indeterminate' : table.getIsAllRowsSelected()
        "
        aria-label="Select all"
        @update:model-value="table.toggleAllRowsSelected($event === true)"
      />
    </template>
    <template v-if="selectable" #select-cell="{ row }">
      <UCheckbox
        v-if="row.getCanSelect()"
        :model-value="row.getIsSelected()"
        :aria-label="`Select ${(rowLabel ?? rowId)(row.original)}`"
        @update:model-value="row.toggleSelected($event === true)"
      />
    </template>

    <template v-for="column in columns" :key="column.id" #[`${column.id}-header`]="{ column: at }">
      <button
        v-if="column.sort"
        type="button"
        class="-mx-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-elevated focus-visible:outline-2 focus-visible:outline-(--ui-primary)"
        :class="column.numeric ? 'flex-row-reverse' : ''"
        @click="at.toggleSorting(at.getIsSorted() === 'asc')"
      >
        {{ column.label }}
        <UIcon
          :name="SORT_ICON[(at.getIsSorted() || 'none') as keyof typeof SORT_ICON]"
          class="size-3.5"
          :class="at.getIsSorted() ? 'text-highlighted' : 'text-dimmed'"
        />
      </button>
      <span v-else :class="column.quiet ? 'sr-only' : ''">{{ column.label }}</span>
    </template>

    <template v-for="column in columns" :key="column.id" #[`${column.id}-cell`]="{ row }">
      <slot :name="column.id" :row="row.original" />
    </template>
  </UTable>
</template>
