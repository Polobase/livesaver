/**
 * The folders the user gives the page: chosen in the folder upload, or dropped. The browser's own
 * folder picker (File System Access API) is not used: its handles hide files with certain names.
 */
import { type FolderSource, foldersFromDrop, foldersFromFiles } from '@livesaver/web'
import { useRef, useState } from 'preact/hooks'
import { count } from './format.js'
import { CloseIcon, FolderIcon, PlusIcon } from './icons.js'
import type { FolderInput, LocatedFolder } from './protocol.js'

/**
 * Folders in which vendors keep installed libraries: Native Instruments uses /Users/Shared, and
 * its libraries are called "… Library". (Ableton's own folders are recognised without this.)
 */
const LIBRARY_NAME = /^(shared|native instruments)$|^(?!user |core ).+ librar(y|ies)$/i

/** Folders are told apart by a number of their own: two can have the same name. */
let folderCount = 0

const HOW: Record<LocatedFolder['how'], string> = {
  typed: 'as typed',
  found: 'found from your sets',
  unknown: 'location unknown',
}

function files(source: FolderSource): string {
  if (source.kind === 'handle') return 'read on demand'
  return `${count(source.kind === 'files' ? source.files.length : source.paths.length)} files`
}

interface RowProps {
  readonly folder: FolderInput
  readonly kind: 'projects' | 'search'
  readonly at: LocatedFolder | undefined
  readonly disabled: boolean
  readonly onChange: (change: Partial<FolderInput>) => void
  readonly onRemove: () => void
}

function FolderRow({ folder, kind, at, disabled, onChange, onRemove }: RowProps) {
  const [editing, setEditing] = useState(false)
  const name = folder.source.name || '(folder)'
  const place = folder.path.trim() || (at && at.how !== 'unknown' ? at.path : '')
  return (
    <li class="folder-row">
      <FolderIcon />
      <div class="folder-main">
        <div>
          <span class="folder-name">{name}</span>{' '}
          <span class="folder-meta">{files(folder.source)}</span>
        </div>
        <div class="folder-meta folder-place">
          {place && `${place} `}
          {place && !folder.path.trim() && at ? `(${HOW[at.how]}) ` : ''}
          <button
            type="button"
            class="link"
            disabled={disabled}
            onClick={() => setEditing(!editing)}
          >
            {editing ? 'Done' : place ? 'Change path' : 'Set path'}
          </button>
        </div>
        {editing && (
          <input
            class="folder-path"
            type="text"
            value={folder.path}
            placeholder="Where the folder lies on disk, e.g. /Users/you/Music"
            aria-label={`Path of ${name} on disk`}
            spellcheck={false}
            disabled={disabled}
            onInput={(event) => onChange({ path: event.currentTarget.value })}
          />
        )}
        {kind === 'search' && (
          <label
            class="check"
            title="Content installed by a vendor, such as Native Instruments libraries. Vendors re-saved some files slightly larger; in such a folder livesaver accepts those when the audio is the same."
          >
            <input
              type="checkbox"
              checked={folder.vendor}
              disabled={disabled}
              onChange={(event) => onChange({ vendor: event.currentTarget.checked })}
            />
            Installed library
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

export interface FolderListProps {
  readonly kind: 'projects' | 'search'
  readonly title: string
  readonly hint: string
  readonly folders: readonly FolderInput[]
  readonly located: ReadonlyMap<string, LocatedFolder>
  readonly disabled: boolean
  readonly onChange: (folders: FolderInput[]) => void
}

export function FolderList(props: FolderListProps) {
  const { kind, folders, located, disabled, onChange } = props
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [reading, setReading] = useState<number | undefined>()
  const [listing, setListing] = useState(false)
  const [problem, setProblem] = useState('')

  const add = (sources: readonly FolderSource[]) => {
    const added = sources.map((source) => ({
      id: `folder-${++folderCount}`,
      source,
      path: '',
      vendor: kind === 'search' && LIBRARY_NAME.test(source.name),
    }))
    if (added.length) onChange([...folders, ...added])
  }

  const failed = (error: unknown) =>
    setProblem(`The folder could not be read: ${(error as Error).message || String(error)}`)

  const pick = () => {
    setProblem('')
    // The browser lists every file of the folder before it hands them over, and reports nothing
    // meanwhile: seconds for a large folder.
    setListing(true)
    input.current?.click()
  }

  const drop = async (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    if (disabled || !event.dataTransfer) return
    setProblem('')
    setReading(0)
    try {
      add(await foldersFromDrop(event.dataTransfer.items, setReading))
    } catch (error) {
      failed(error)
    } finally {
      setReading(undefined)
    }
  }

  return (
    <section
      class={`folders${dragging ? ' dragging' : ''}`}
      aria-labelledby={`${kind}-title`}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
    >
      <h2 id={`${kind}-title`}>{props.title}</h2>
      <p class="hint">{props.hint}</p>
      <ul class="folder-rows">
        {folders.map((folder) => (
          <FolderRow
            key={folder.id}
            folder={folder}
            kind={kind}
            at={located.get(folder.id)}
            disabled={disabled}
            onChange={(change) =>
              onChange(folders.map((f) => (f.id === folder.id ? { ...f, ...change } : f)))
            }
            onRemove={() => onChange(folders.filter((f) => f.id !== folder.id))}
          />
        ))}
      </ul>
      <div class="folder-add">
        <button type="button" disabled={disabled} onClick={pick}>
          <PlusIcon />
          Add folder
        </button>
        <span class="hint">
          {reading !== undefined
            ? `listing… ${count(reading)} files`
            : listing
              ? 'a large folder takes a few seconds to appear…'
              : 'or drop a folder here'}
        </span>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          data-testid={`${kind}-input`}
          {...{ webkitdirectory: true }}
          onChange={(event) => {
            setListing(false)
            add(foldersFromFiles(event.currentTarget.files ?? []))
            event.currentTarget.value = ''
          }}
          onCancel={() => setListing(false)}
        />
      </div>
      {problem && (
        <p class="hint problem" role="alert">
          {problem}
        </p>
      )}
    </section>
  )
}
