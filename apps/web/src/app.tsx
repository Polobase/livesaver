/**
 * The page on its own, in a browser: it is given folders, checks them in a worker and shows the
 * result. It can only read, so it cannot fix (see `local-app.tsx` for the page with livesaver).
 */
import { useEffect, useRef, useState } from 'preact/hooks'
import { FolderList } from './folders.js'
import { INSTALLED } from './format.js'
import { HealthIcon } from './icons.js'
import type {
  EngineEvent,
  FolderInput,
  LocatedFolder,
  RunOptions,
  ToEngine,
  WireFolder,
} from './protocol.js'
import { NoLibraryMarked, Options, Progress, Results, type RunState, starting } from './shared.js'

/** A folder as it travels to the engine: an upload as the paths of its files, without the files. */
function wire(folder: FolderInput): WireFolder {
  const { source } = folder
  if (source.kind === 'handle') return { ...folder, source }
  const paths = source.kind === 'files' ? source.files.map((f) => f.path) : source.paths
  return { ...folder, source: { kind: 'listing', name: source.name, paths } }
}

export function App() {
  const [projects, setProjects] = useState<FolderInput[]>([])
  const [search, setSearch] = useState<FolderInput[]>([])
  const [options, setOptions] = useState<RunOptions>({ packLimitMB: 50, matchLibraryPath: false })
  const [state, setState] = useState<RunState>({ kind: 'idle' })
  const [located, setLocated] = useState<ReadonlyMap<string, LocatedFolder>>(new Map())
  const engine = useRef<Worker | undefined>(undefined)
  const running = state.kind === 'running'

  // A folder dropped beside the two lists must not make the browser leave the page for it.
  useEffect(() => {
    const ignore = (event: DragEvent) => event.preventDefault()
    window.addEventListener('dragover', ignore)
    window.addEventListener('drop', ignore)
    return () => {
      window.removeEventListener('dragover', ignore)
      window.removeEventListener('drop', ignore)
    }
  }, [])

  const stop = () => {
    engine.current?.terminate()
    engine.current = undefined
  }

  const start = () => {
    stop()
    const worker = new Worker(new URL('./engine.worker.js', import.meta.url), { type: 'module' })
    engine.current = worker
    let run = starting('locating')
    setLocated(new Map())
    setState(run)
    const folders = [...projects, ...search]
    worker.onmessage = ({ data }: MessageEvent<EngineEvent>) => {
      if (data.type === 'open') {
        // The files of a folder stay here; the engine gets each one when it reads it.
        const source = folders.find((f) => f.id === data.folder)?.source
        const reply = (file: File | undefined) =>
          worker.postMessage({ type: 'file', request: data.request, file } satisfies ToEngine)
        if (source?.kind === 'listing')
          void source.open(data.index).then(reply, () => reply(undefined))
        else reply(source?.kind === 'files' ? source.files[data.index]?.file : undefined)
        return
      }
      if (data.type === 'located') return setLocated(new Map(data.folders.map((f) => [f.id, f])))
      if (data.type === 'done' || data.type === 'failed') {
        stop()
        return setState(
          data.type === 'done'
            ? { kind: 'done', result: data.result }
            : { kind: 'failed', message: data.message },
        )
      }
      if (data.type === 'phase') run = { ...run, phase: data.phase }
      else if (data.type === 'indexed') run = { ...run, files: data.files }
      else run = { ...run, done: data.done, total: data.total, name: data.name }
      setState(run)
    }
    worker.onerror = (event) => {
      stop()
      setState({ kind: 'failed', message: event.message || 'The check stopped unexpectedly.' })
    }
    worker.postMessage({
      type: 'run',
      projects: projects.map(wire),
      search: search.map(wire),
      options,
    } satisfies ToEngine)
  }

  return (
    <main>
      <header class="top">
        <h1>livesaver</h1>
        <p>
          Check your Ableton Live projects for missing samples. Your files stay on this computer,
          and nothing is changed.
        </p>
      </header>

      <section class="card" aria-label="Folders and options">
        <div class="columns">
          <FolderList
            kind="projects"
            title="Projects"
            hint="Folders with your Live projects. Every set in them is checked."
            folders={projects}
            located={located}
            disabled={running}
            onChange={setProjects}
          />
          <FolderList
            kind="search"
            title="Sample folders"
            hint="Where to look for missing samples: sample folders, the User Library, Factory Packs, installed libraries. The project folders are searched as well."
            folders={search}
            located={located}
            disabled={running}
            onChange={setSearch}
          />
        </div>
        <p class="hint note">
          Your browser may ask whether to "upload" a folder. Nothing is uploaded: the files are only
          read by this page, on your computer.
        </p>
        <details class="about">
          <summary>Which sample folders?</summary>
          <p>The more of these you add, the more is found:</p>
          <ul>
            <li>your own sample folders;</li>
            <li>
              <code>Music/Ableton</code> in your home folder (User Library and Factory Packs);
            </li>
            <li>
              Live's own content (the Core Library, and Live's list of content it moved between
              versions): drag the Ableton Live app from your Applications folder onto Sample
              folders. The folder dialog cannot open an app, but{' '}
              <code>/Applications/Ableton Live 12 Suite.app/Contents/App-Resources</code> can be
              pasted there after pressing ⌘⇧G;
            </li>
            <li>
              <code>/Users/Shared</code>, where Native Instruments installs its libraries. Leave "
              {INSTALLED}" ticked for such a folder: vendors re-saved some files slightly larger,
              and livesaver then accepts those when the audio is the same.
            </li>
          </ul>
        </details>
        <details class="about">
          <summary>What is the path for?</summary>
          <p>
            A browser does not tell a page where a folder lies on your disk. For project folders
            livesaver works it out from the sets. For a sample folder you can type it: then a
            reference to a file in that folder counts as "outside the project, can be collected", as
            on the command line. Without it, the file is found by its name and fingerprint and
            counts as "missing, can be repaired".
          </p>
        </details>
        <Options
          options={options}
          disabled={running}
          onChange={setOptions}
          libraryNote={!search.some((folder) => folder.vendor) && <NoLibraryMarked />}
        />
        <div class="actions">
          <button
            type="button"
            class="primary"
            disabled={running || projects.length === 0}
            onClick={start}
          >
            Check sets
          </button>
          {running && (
            <button
              type="button"
              onClick={() => {
                stop()
                setState({ kind: 'idle' })
              }}
            >
              Cancel
            </button>
          )}
          {projects.length === 0 && <span class="hint">Add a project folder to start.</span>}
        </div>
        {running && <Progress run={state} />}
        {state.kind === 'failed' && (
          <p class="callout" role="alert">
            <HealthIcon health="missing" />
            The check failed: {state.message}
          </p>
        )}
      </section>

      {state.kind === 'done' && (
        <Results
          result={state.result}
          liveAdvice="Drag the Ableton Live app from your Applications folder onto Sample folders, and check again."
        />
      )}
    </main>
  )
}
