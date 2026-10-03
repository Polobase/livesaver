/** The result of a run: headline numbers, the state of the references, and where samples come from. */
import type { Status } from '@livesaver/ops'
import { Fragment } from 'preact'
import { useState } from 'preact/hooks'
import {
  bytes,
  count,
  HEALTH,
  HEALTH_LABEL,
  type Health,
  percent,
  plural,
  STATUS_LABEL,
  STATUSES,
} from './format.js'
import { DownloadIcon, HealthIcon } from './icons.js'
import type { RunResult, SourceRow } from './protocol.js'

function Tile(props: { label: string; value: string; note: string }) {
  return (
    <div class="tile">
      <div class="tile-label">{props.label}</div>
      <div class="tile-value">{props.value}</div>
      <div class="tile-note">{props.note}</div>
    </div>
  )
}

export function Tiles({ result }: { result: RunResult }) {
  const c = result.counts
  return (
    <div class="tiles">
      <Tile
        label="Sets complete"
        value={count(result.completeSets)}
        note={`of ${plural(result.sets, 'set')} in ${plural(result.projects, 'project')}`}
      />
      <Tile
        label="Missing samples"
        value={count(result.missing.length)}
        note={`from ${plural(result.missingSources.length, 'source')}`}
      />
      <Tile
        label="References to repair"
        value={count(c.found)}
        note={result.uncertain ? `${count(result.uncertain)} uncertain` : 'all verified'}
      />
      <Tile
        label="References to collect"
        value={count(c.external)}
        note="files outside their project"
      />
      <Tile label="Files to copy" value={count(result.copyFiles)} note={bytes(result.copyBytes)} />
    </div>
  )
}

const HEALTHS: readonly Health[] = ['fine', 'fixable', 'missing']

/** Part-to-whole: how many references are fine, can be fixed, or stay missing. */
export function References({ counts }: { counts: Readonly<Record<Status, number>> }) {
  const total = STATUSES.reduce((n, s) => n + counts[s], 0)
  const sum = (health: Health) =>
    STATUSES.filter((s) => HEALTH[s] === health).reduce((n, s) => n + counts[s], 0)
  return (
    <section class="card" aria-labelledby="references-title">
      <h2 id="references-title">Sample references</h2>
      <p class="hint">
        {count(total)} references, counted per set: a sample used in several sets counts several
        times.
      </p>
      <div
        class="stack"
        role="img"
        aria-label="Share of references that are fine, can be fixed, or are missing"
      >
        {HEALTHS.filter((h) => sum(h) > 0).map((health) => (
          <div
            key={health}
            class={`segment segment-${health}`}
            style={{ flexGrow: sum(health) }}
            title={`${HEALTH_LABEL[health]}: ${count(sum(health))} (${percent(sum(health), total)})`}
          />
        ))}
      </div>
      <table class="legend">
        <tbody>
          {HEALTHS.map((health) => (
            <Fragment key={health}>
              <tr class="legend-group">
                <th scope="row">
                  <HealthIcon health={health} />
                  {HEALTH_LABEL[health]}
                </th>
                <td>{count(sum(health))}</td>
                <td>{percent(sum(health), total)}</td>
              </tr>
              {STATUSES.filter((s) => HEALTH[s] === health).map((status) => (
                <tr key={status} class="legend-detail">
                  <th scope="row">{STATUS_LABEL[status]}</th>
                  <td>{count(counts[status])}</td>
                  <td>{percent(counts[status], total)}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </section>
  )
}

const SHOWN = 10

/** One series (samples per source), so every bar wears the same colour; the name tells them apart. */
export function Sources(props: { title: string; empty: string; rows: readonly SourceRow[] }) {
  const [all, setAll] = useState(false)
  const rows = all ? props.rows : props.rows.slice(0, SHOWN)
  const largest = props.rows[0]?.samples ?? 0
  const id = props.title.replaceAll(' ', '-').toLowerCase()
  return (
    <section class="card" aria-labelledby={id}>
      <h2 id={id}>{props.title}</h2>
      {props.rows.length === 0 ? (
        <p class="hint">{props.empty}</p>
      ) : (
        <table class="bars">
          <thead class="visually-hidden">
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Samples</th>
              <th scope="col">Projects</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.kind}:${row.name}`} title={row.hint || undefined}>
                <th scope="row">
                  <span class="bar-kind">{row.kind}</span>
                  <span class="bar-name">{row.name}</span>
                  {row.hint && <span class="bar-hint">{row.hint}</span>}
                  <span class="bar-track">
                    <span
                      class="bar"
                      style={{ width: `${Math.max(1, (row.samples / largest) * 100)}%` }}
                    />
                  </span>
                </th>
                <td class="bar-value">{count(row.samples)}</td>
                <td class="bar-projects">in {plural(row.projects, 'project')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {props.rows.length > SHOWN && (
        <button type="button" class="link" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${count(props.rows.length)}`}
        </button>
      )}
    </section>
  )
}

const REPORT_TITLES: Record<string, string> = {
  'overview.md': 'Overview',
  'missing_samples.csv': 'Missing samples',
  'missing_sources.csv': 'Missing sources',
  'projects.csv': 'Sets',
  'changes.csv': 'Planned changes',
}

function download(name: string, content: string): void {
  const type = name.endsWith('.csv') ? 'text/csv' : 'text/markdown'
  const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  // Not at once: some browsers start the download only after this function has returned.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function Reports({ reports }: { reports: Readonly<Record<string, string>> }) {
  return (
    <section class="card" aria-labelledby="reports-title">
      <h2 id="reports-title">Reports</h2>
      <p class="hint">The same files the command line writes, for a spreadsheet or to keep.</p>
      <div class="downloads">
        {Object.keys(REPORT_TITLES)
          .filter((name) => name in reports)
          .map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => download(name, reports[name] as string)}
            >
              <DownloadIcon />
              {REPORT_TITLES[name]}
              <span class="file-name">{name}</span>
            </button>
          ))}
      </div>
    </section>
  )
}

export function RunFacts({ result }: { result: RunResult }) {
  const { ableton, usage } = result
  const own = Object.entries({
    'User Library': ableton.userLibrary,
    'Factory Packs': ableton.factoryPacks,
    'Core Library': ableton.coreLibrary,
  }).filter(([, path]) => path)
  return (
    <p
      class="facts"
      title={Object.entries(result.phases ?? {})
        .map(([phase, seconds]) => `${phase} ${seconds.toFixed(1)} s`)
        .join(', ')}
    >
      Checked {plural(result.sets, 'set')} against {count(result.indexedFiles)} audio files and Max
      devices in {result.seconds.toFixed(1)} s
      {usage
        ? `, reading ${bytes(usage.bytes)} from ${plural(usage.opened, 'file')}`
        : ' on this computer'}
      .{' '}
      {own.length > 0
        ? `Recognised: ${own.map(([name]) => name).join(', ')}.`
        : 'No User Library, Factory Packs or Core Library among the folders.'}{' '}
      {ableton.remapEntries > 0
        ? `Live's list of content it moved between versions was used (${count(ableton.remapEntries)} entries). `
        : ableton.coreLibrary
          ? "Give Live's whole App-Resources folder instead of the Core Library, and content Live moved between versions is found too. "
          : ''}
      {usage ? 'Nothing was changed: this page only reads.' : 'The check changed nothing.'}
    </p>
  )
}
