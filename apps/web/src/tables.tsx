/** The details of a run: every set, every missing sample, every planned change. */
import type { ComponentChildren } from 'preact'
import { useMemo, useState } from 'preact/hooks'
import { ACTION_LABEL, bytes, count, type Health, STATUS_LABEL } from './format.js'
import { HealthIcon } from './icons.js'
import type { ChangeRow, MissingRow, RunResult, SetRow } from './protocol.js'

const PAGE = 50

interface Column<T> {
  readonly header: string
  readonly cell: (row: T) => ComponentChildren
  readonly numeric?: boolean
}

interface Filter<T> {
  readonly label: string
  readonly test: (row: T) => boolean
}

interface TableProps<T> {
  readonly name: string
  readonly rows: readonly T[]
  readonly columns: readonly Column<T>[]
  readonly filters: readonly Filter<T>[]
  /** The text a search is matched against. */
  readonly text: (row: T) => string
}

function Path({ value }: { value: string }) {
  return (
    <span class="path" title={value}>
      {value}
    </span>
  )
}

function Table<T>(props: TableProps<T>) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState(0)
  const [shown, setShown] = useState(PAGE)
  const rows = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const test = props.filters[filter]?.test ?? (() => true)
    return props.rows.filter((row) => {
      if (!test(row)) return false
      if (words.length === 0) return true
      const text = props.text(row).toLowerCase()
      return words.every((word) => text.includes(word))
    })
  }, [props.rows, props.filters, props.text, query, filter])

  return (
    <div>
      <div class="filters">
        <input
          type="search"
          value={query}
          placeholder={`Search ${props.name}`}
          aria-label={`Search ${props.name}`}
          autocomplete="off"
          onInput={(event) => {
            setQuery(event.currentTarget.value)
            setShown(PAGE)
          }}
        />
        <select
          aria-label={`Filter ${props.name}`}
          value={filter}
          autocomplete="off"
          onChange={(event) => {
            setFilter(Number(event.currentTarget.value))
            setShown(PAGE)
          }}
        >
          {props.filters.map((f, i) => (
            <option key={f.label} value={i}>
              {f.label}
            </option>
          ))}
        </select>
        <span class="hint" aria-live="polite">
          {count(rows.length)} of {count(props.rows.length)}
        </span>
      </div>
      <div class="table-scroll">
        <table class="data">
          <thead>
            <tr>
              {props.columns.map((column) => (
                <th key={column.header} scope="col" class={column.numeric ? 'num' : undefined}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((row, i) => (
              <tr key={i}>
                {props.columns.map((column) => (
                  <td key={column.header} class={column.numeric ? 'num' : undefined}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p class="hint empty">Nothing matches.</p>}
      </div>
      {rows.length > shown && (
        <button type="button" class="link" onClick={() => setShown(shown + PAGE * 5)}>
          Show more ({count(rows.length - shown)} left)
        </button>
      )}
    </div>
  )
}

function setState(row: SetRow): [Health, string] {
  if (row.error) return ['missing', 'Unreadable']
  const c = row.counts
  if (c['not-found'] + c.ambiguous + c.mismatch > 0) return ['missing', 'Incomplete']
  return row.changes > 0 ? ['fixable', 'Can be fixed'] : ['fine', 'Complete']
}

function State({ health, label }: { health: Health; label: string }) {
  return (
    <span class="state">
      <HealthIcon health={health} />
      {label}
    </span>
  )
}

const zero = (n: number) => (n ? count(n) : <span class="zero">0</span>)

const SET_COLUMNS: readonly Column<SetRow>[] = [
  { header: 'Project', cell: (r) => <Path value={r.project} /> },
  { header: 'Set', cell: (r) => <Path value={r.error ? `${r.name}: ${r.error}` : r.name} /> },
  { header: 'Live', cell: (r) => r.live },
  { header: 'State', cell: (r) => <State health={setState(r)[0]} label={setState(r)[1]} /> },
  { header: 'Fine', cell: (r) => zero(r.counts.ok + r.counts.kept), numeric: true },
  { header: 'Collect', cell: (r) => zero(r.counts.external), numeric: true },
  { header: 'Repair', cell: (r) => zero(r.counts.found), numeric: true },
  { header: 'Not found', cell: (r) => zero(r.counts['not-found']), numeric: true },
  { header: 'Ambiguous', cell: (r) => zero(r.counts.ambiguous), numeric: true },
  { header: 'Different', cell: (r) => zero(r.counts.mismatch), numeric: true },
]

const SET_FILTERS: readonly Filter<SetRow>[] = [
  { label: 'All sets', test: () => true },
  { label: 'Incomplete', test: (r) => setState(r)[1] === 'Incomplete' },
  { label: 'Can be fixed', test: (r) => setState(r)[1] === 'Can be fixed' },
  { label: 'Complete', test: (r) => setState(r)[1] === 'Complete' },
  { label: 'Unreadable', test: (r) => Boolean(r.error) },
]

const MISSING_COLUMNS: readonly Column<MissingRow>[] = [
  { header: 'State', cell: (r) => <State health="missing" label={STATUS_LABEL[r.status]} /> },
  { header: 'Name', cell: (r) => <Path value={r.name} /> },
  { header: 'Kind', cell: (r) => (r.device ? 'Max device' : 'Sample') },
  { header: 'Original path', cell: (r) => <Path value={r.path} /> },
  { header: 'Came from', cell: (r) => <Path value={r.source} /> },
  { header: 'Size', cell: (r) => (r.size ? bytes(r.size) : ''), numeric: true },
  { header: 'Sets', cell: (r) => count(r.sets), numeric: true },
  { header: 'Projects', cell: (r) => count(r.projects), numeric: true },
  {
    header: 'Files with this name',
    cell: (r) => <Path value={r.candidates.join('\n')} />,
  },
]

const MISSING_FILTERS: readonly Filter<MissingRow>[] = [
  { label: 'All missing samples', test: () => true },
  { label: 'Not found', test: (r) => r.status === 'not-found' },
  { label: 'Different content', test: (r) => r.status === 'mismatch' },
  { label: 'Ambiguous', test: (r) => r.status === 'ambiguous' },
]

const CHANGE_COLUMNS: readonly Column<ChangeRow>[] = [
  { header: 'Project', cell: (r) => <Path value={r.project} /> },
  { header: 'Set', cell: (r) => <Path value={r.set} /> },
  { header: 'Action', cell: (r) => ACTION_LABEL[r.action] ?? r.action },
  { header: 'Sample', cell: (r) => <Path value={r.name} /> },
  { header: 'Old path', cell: (r) => <Path value={r.oldPath} /> },
  { header: 'New path', cell: (r) => <Path value={r.newPath} /> },
  { header: 'Copied from', cell: (r) => <Path value={r.source} /> },
  { header: 'How it was found', cell: (r) => <Path value={r.method} /> },
  { header: 'Confidence', cell: (r) => (r.certain ? 'certain' : 'uncertain') },
]

const CHANGE_FILTERS: readonly Filter<ChangeRow>[] = [
  { label: 'All planned changes', test: () => true },
  { label: 'Repair', test: (r) => r.action === 'repaired' },
  { label: 'Collect', test: (r) => r.action === 'collected' },
  { label: 'Update path', test: (r) => r.action === 'path-updated' },
  { label: 'Uncertain', test: (r) => !r.certain },
]

const setText = (r: SetRow) => `${r.project} ${r.name} ${r.live} ${r.error}`
const missingText = (r: MissingRow) => `${r.name} ${r.path} ${r.source}`
const changeText = (r: ChangeRow) =>
  `${r.project} ${r.set} ${r.name} ${r.oldPath} ${r.newPath} ${r.source}`

type Tab = 'sets' | 'missing' | 'changes'

export function Details({ result }: { result: RunResult }) {
  const [tab, setTab] = useState<Tab>('sets')
  const tabs: readonly [Tab, string, number][] = [
    ['sets', 'Sets', result.setRows.length],
    ['missing', 'Missing samples', result.missing.length],
    ['changes', 'Planned changes', result.changes.length],
  ]
  return (
    <section class="card" aria-label="Details">
      <div class="tabs" role="tablist">
        {tabs.map(([id, label, n]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls="tab-panel"
            class={tab === id ? 'tab selected' : 'tab'}
            onClick={() => setTab(id)}
          >
            {label} <span class="tab-count">{count(n)}</span>
          </button>
        ))}
      </div>
      <div id="tab-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'sets' && (
          <Table
            name="sets"
            rows={result.setRows}
            columns={SET_COLUMNS}
            filters={SET_FILTERS}
            text={setText}
          />
        )}
        {tab === 'missing' && (
          <Table
            name="missing samples"
            rows={result.missing}
            columns={MISSING_COLUMNS}
            filters={MISSING_FILTERS}
            text={missingText}
          />
        )}
        {tab === 'changes' && (
          <Table
            name="planned changes"
            rows={result.changes}
            columns={CHANGE_COLUMNS}
            filters={CHANGE_FILTERS}
            text={changeText}
          />
        )}
      </div>
    </section>
  )
}
