/**
 * Choosing a folder of this computer in the page. A browser's own folder dialog hands a page the
 * files but never the folder's path, and the path is what livesaver on this computer needs; so
 * livesaver lists the folders, and the page shows them.
 */
import type { WebFolders, WebPlace } from 'livesaver'
import { useEffect, useRef, useState } from 'preact/hooks'
import { FolderIcon } from './icons.js'
import type { Local } from './local.js'

interface BrowserProps {
  readonly local: Local
  readonly title: string
  /** The folder to open first ('' = the home folder). */
  readonly start: string
  readonly places: readonly WebPlace[]
  readonly onChoose: (folder: WebFolders) => void
  readonly onCancel: () => void
}

export function FolderBrowser({ local, title, start, places, onChoose, onCancel }: BrowserProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [listing, setListing] = useState<WebFolders>()
  const [typed, setTyped] = useState(start)
  const [problem, setProblem] = useState('')

  const open = async (path: string) => {
    setProblem('')
    try {
      const next = await local.folders(path)
      setListing(next)
      setTyped(next.path)
    } catch (error) {
      setProblem((error as Error).message)
    }
  }

  // Opened once, where it starts.
  useEffect(() => {
    dialog.current?.showModal()
    void open(start)
  }, [])

  return (
    <dialog ref={dialog} class="dialog browser" aria-labelledby="browser-title" onClose={onCancel}>
      <h2 id="browser-title">{title}</h2>
      <form
        class="browser-path"
        onSubmit={(event) => {
          event.preventDefault()
          void open(typed)
        }}
      >
        <input
          type="text"
          value={typed}
          aria-label="Path of the folder"
          placeholder="Type or paste a path"
          spellcheck={false}
          autocomplete="off"
          onInput={(event) => setTyped(event.currentTarget.value)}
        />
        <button type="submit">Open</button>
      </form>
      <div class="places">
        {places.map((place) => (
          <button key={place.path} type="button" class="link" onClick={() => open(place.path)}>
            {place.name}
          </button>
        ))}
      </div>
      {problem && (
        <p class="hint problem" role="alert">
          This folder cannot be opened: {problem}
        </p>
      )}
      <ul class="browser-list" aria-label="Folders in this folder">
        {listing?.parent && (
          <li>
            <button type="button" class="browser-item" onClick={() => open(listing.parent)}>
              <span class="up">↑</span>
              Up
            </button>
          </li>
        )}
        {listing?.folders.map((folder) => (
          <li key={folder.path}>
            <button type="button" class="browser-item" onClick={() => open(folder.path)}>
              <FolderIcon />
              {folder.name}
            </button>
          </li>
        ))}
        {listing && listing.folders.length === 0 && <li class="hint">No folders in here.</li>}
      </ul>
      <div class="dialog-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          class="primary"
          disabled={!listing}
          onClick={() => listing && onChoose(listing)}
        >
          Add this folder
        </button>
      </div>
    </dialog>
  )
}
