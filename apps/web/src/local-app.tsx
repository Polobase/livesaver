/**
 * The page with livesaver on this computer behind it (`livesaver web`): folders are given by their
 * paths, the computer itself checks them like `livesaver doctor`, and it can fix what it finds,
 * all projects or one, like `livesaver collect --apply`.
 */
import type { WebEvent, WebFolderInfo, WebFolders, WebInfo, WebRequest } from 'livesaver'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { ConfirmFix, FixNote, type Note, planOf } from './fix.js'
import { FolderBrowser } from './folder-browser.js'
import { INSTALLED, inPageWords, LIBRARY_NAME } from './format.js'
import { CloseIcon, FolderIcon, HealthIcon, PlusIcon } from './icons.js'
import { Local } from './local.js'
import type { ProjectRow, RunOptions } from './protocol.js'
import { NoLibraryMarked, Options, Progress, Results, type RunState, starting } from './shared.js'

const LIVE = "Live's own content"
const nameOf = (path: string) => path.split('/').filter(Boolean).pop() ?? path

interface RowProps {
  readonly path: string
  readonly folder?: WebFolderInfo
  readonly disabled: boolean
  readonly onVendor?: (vendor: boolean) => void
  readonly onRemove: () => void
}

function PathRow({ path, folder, disabled, onVendor, onRemove }: RowProps) {
  const name = nameOf(path)
  return (
    <li class="folder-row">
      <FolderIcon />
      <div class="folder-main">
        <div>
          <span class="folder-name">{name}</span>{' '}
          <span class="folder-meta">{folder?.holds.join(' · ')}</span>
        </div>
        <div class="folder-meta folder-place">
          {path}
          {folder && !folder.exists && ' (this folder does not exist)'}
        </div>
        {/* Live's own content always counts as installed; there is nothing to say about it. */}
        {folder && onVendor && !folder.holds.includes(LIVE) && (
          <label class="check">
            <input
              type="checkbox"
              checked={folder.vendor}
              disabled={disabled}
              autocomplete="off"
              onChange={(event) => onVendor(event.currentTarget.checked)}
            />
            {INSTALLED}
          </label>
        )}
      </div>
      <button
        type="button"
        class="ghost"
        aria-label={`Remove ${name}`}
        disabled={disabled}
        onClick={onRemove}
      >
        <CloseIcon />
      </button>
    </li>
  )
}

export function LocalApp({ token }: { token: string }) {
  const local = useMemo(() => new Local(token), [token])
  const [info, setInfo] = useState<WebInfo>()
  const [unreachable, setUnreachable] = useState('')
  const [projects, setProjects] = useState<readonly string[]>([])
  const [search, setSearch] = useState<readonly WebFolderInfo[]>([])
  const [options, setOptions] = useState<RunOptions>({ packLimitMB: 50, matchLibraryPath: false })
  const [state, setState] = useState<RunState>({ kind: 'idle' })
  const [note, setNote] = useState<Note>()
  /** The fix that waits for a yes: of one project, or of all (`{}`). */
  const [asking, setAsking] = useState<{ readonly project?: ProjectRow }>()
  const [browsing, setBrowsing] = useState<'projects' | 'search'>()
  const [undoing, setUndoing] = useState(false)
  /** What the result on the page was checked with: a fix does exactly that, nothing newer. */
  const [checkedWith, setCheckedWith] = useState<WebRequest>()
  const busy = state.kind === 'running' || undoing

  useEffect(() => {
    local.info().then(
      (start) => {
        setInfo(start)
        setProjects(start.projects)
        setSearch(start.search)
        setOptions(start.options)
        if (start.lastFix) setNote({ kind: 'earlier', last: start.lastFix })
      },
      (error: Error) => setUnreachable(error.message),
    )
  }, [local])

  const request = (): WebRequest => ({
    projects,
    search: search.map(({ path, vendor }) => ({ path, vendor })),
    options,
  })

  /** Runs a check or a fix, shows how far it is, and answers what it ended with. */
  const follow = async (
    kind: 'check' | 'fix',
    asked: WebRequest,
    only?: string,
  ): Promise<WebEvent | undefined> => {
    let run = starting('indexing')
    setState(run)
    let last: WebEvent | undefined
    try {
      await local[kind]({ ...asked, ...(only ? { only } : {}) }, (event) => {
        last = event
        if (event.type === 'phase') run = { ...run, phase: event.phase }
        else if (event.type === 'indexed') run = { ...run, files: event.files }
        else if (event.type === 'progress')
          run = { ...run, done: event.done, total: event.total, name: event.name }
        else return
        setState(run)
      })
    } catch (error) {
      last = { type: 'failed', message: (error as Error).message }
    }
    return last
  }

  const check = async () => {
    const asked = request()
    const last = await follow('check', asked)
    if (last?.type === 'done') setCheckedWith(asked)
    setState(
      last?.type === 'done'
        ? { kind: 'done', result: { ...inPageWords(last.result), folders: [] } }
        : {
            kind: 'failed',
            message: last?.type === 'failed' ? last.message : 'It stopped unexpectedly.',
          },
    )
  }

  const fix = async (project?: ProjectRow) => {
    const before = state
    setAsking(undefined)
    setNote(undefined)
    const last = await follow('fix', checkedWith ?? request(), project?.root)
    if (last?.type === 'fixed') {
      const what = project ? `"${project.path}"` : 'all projects'
      setNote({ kind: 'fixed', what, fixed: last.fixed })
      return check()
    }
    const failed = last?.type === 'failed' ? last : undefined
    setNote({
      kind: 'problem',
      message: `The fix failed: ${failed?.message ?? 'it stopped unexpectedly.'}`,
      ...(failed?.run ? { run: failed.run } : {}),
    })
    // What was found is still what there is, unless the fix got somewhere.
    if (failed?.run) return check()
    setState(before)
  }

  const undo = async (run: string) => {
    setUndoing(true)
    try {
      const undone = await local.undo(run)
      // The fix before it, if there is one, is the next that can be undone.
      const earlier = (await local.info().catch(() => undefined))?.lastFix
      setNote({ kind: 'undone', undone, ...(earlier ? { earlier } : {}) })
    } catch (error) {
      setNote({ kind: 'problem', message: `The undo failed: ${(error as Error).message}` })
    } finally {
      setUndoing(false)
    }
    return check()
  }

  const add = (folder: WebFolders) => {
    const list = browsing
    setBrowsing(undefined)
    if (list === 'projects') {
      if (!projects.includes(folder.path)) setProjects([...projects, folder.path])
    } else if (!search.some((f) => f.path === folder.path)) {
      const vendor = LIBRARY_NAME.test(nameOf(folder.path))
      setSearch([...search, { path: folder.path, vendor, holds: folder.holds, exists: true }])
    }
  }

  if (unreachable)
    return (
      <main>
        <p class="callout" role="alert">
          <HealthIcon health="missing" />
          livesaver on this computer does not answer ({unreachable}). Start it again with{' '}
          <code>livesaver web</code> and reload this page.
        </p>
      </main>
    )

  return (
    <main>
      <header class="top">
        <h1>livesaver</h1>
        <p>
          Check your Ableton Live projects for missing samples, and fix them. livesaver on this
          computer reads and writes the files; nothing leaves it.
        </p>
      </header>

      <section class="card" aria-label="Folders and options">
        <div class="columns">
          <section class="folders" aria-labelledby="projects-title">
            <h2 id="projects-title">Projects</h2>
            <p class="hint">Folders with your Live projects. Every set in them is checked.</p>
            <ul class="folder-rows">
              {projects.map((path) => (
                <PathRow
                  key={path}
                  path={path}
                  disabled={busy}
                  onRemove={() => setProjects(projects.filter((p) => p !== path))}
                />
              ))}
            </ul>
            <div class="folder-add">
              <button
                type="button"
                disabled={busy || !info}
                onClick={() => setBrowsing('projects')}
              >
                <PlusIcon />
                Add folder
              </button>
            </div>
            {projects.length === 0 && (info?.suggested.length ?? 0) > 0 && (
              <div class="wanted">
                <p>Checked before on this computer:</p>
                <ul>
                  {info?.suggested.map((path) => (
                    <li key={path}>
                      {path}{' '}
                      <button type="button" class="link" onClick={() => setProjects([path])}>
                        Add it
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          <section class="folders" aria-labelledby="search-title">
            <h2 id="search-title">Sample folders</h2>
            <p class="hint">
              Where livesaver looks for missing samples, as on the command line. The project folders
              are searched as well.
            </p>
            <ul class="folder-rows">
              {search.map((folder) => (
                <PathRow
                  key={folder.path}
                  path={folder.path}
                  folder={folder}
                  disabled={busy}
                  onVendor={(vendor) =>
                    setSearch(search.map((f) => (f.path === folder.path ? { ...f, vendor } : f)))
                  }
                  onRemove={() => setSearch(search.filter((f) => f.path !== folder.path))}
                />
              ))}
            </ul>
            <div class="folder-add">
              <button type="button" disabled={busy || !info} onClick={() => setBrowsing('search')}>
                <PlusIcon />
                Add folder
              </button>
            </div>
          </section>
        </div>
        <Options
          options={options}
          disabled={busy}
          onChange={setOptions}
          libraryNote={!search.some((folder) => folder.vendor) && <NoLibraryMarked />}
        />
        <div class="actions">
          <button
            type="button"
            class="primary"
            disabled={busy || projects.length === 0}
            onClick={check}
          >
            Check sets
          </button>
          {projects.length === 0 && <span class="hint">Add a project folder to start.</span>}
        </div>
        {state.kind === 'running' && <Progress run={state} />}
        {state.kind === 'failed' && (
          <p class="callout" role="alert">
            <HealthIcon health="missing" />
            The check failed: {state.message}
          </p>
        )}
      </section>

      {note && <FixNote note={note} busy={busy} onUndo={undo} />}
      {state.kind === 'done' && (
        <Results
          result={state.result}
          liveAdvice="Add the Core Library of your Live app to the sample folders (in the app: Contents/App-Resources/Core Library), and check again."
          onFix={(project) => setAsking(project ? { project } : {})}
          stale={JSON.stringify(checkedWith) !== JSON.stringify(request())}
        />
      )}
      {asking && state.kind === 'done' && (
        <ConfirmFix
          plan={planOf(state.result, asking.project)}
          onConfirm={() => fix(asking.project)}
          onCancel={() => setAsking(undefined)}
        />
      )}
      {browsing && info && (
        <FolderBrowser
          local={local}
          title={browsing === 'projects' ? 'Add a project folder' : 'Add a sample folder'}
          start={projects.at(-1) ?? info.suggested[0] ?? info.home}
          places={info.places}
          onChoose={add}
          onCancel={() => setBrowsing(undefined)}
        />
      )}
    </main>
  )
}
