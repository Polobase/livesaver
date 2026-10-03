/** Small line icons (16 px), drawn in the current text colour unless a status colours them. */
import type { ComponentChildren } from 'preact'
import type { Health } from './format.js'

function Icon({ children, label }: { children: ComponentChildren; label?: string }) {
  return (
    <svg
      class="icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      role={label ? 'img' : 'presentation'}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {children}
    </svg>
  )
}

export const FolderIcon = () => (
  <Icon>
    <path d="M1.8 4.2c0-.7.5-1.2 1.2-1.2h3.1l1.5 1.6H13c.7 0 1.2.5 1.2 1.2v6c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2z" />
  </Icon>
)

export const PlusIcon = () => (
  <Icon>
    <path d="M8 3.2v9.6M3.2 8h9.6" />
  </Icon>
)

export const CloseIcon = () => (
  <Icon>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
)

export const DownloadIcon = () => (
  <Icon>
    <path d="M8 2.5v7.5M4.8 7.2L8 10.4l3.2-3.2M3 13h10" />
  </Icon>
)

/** Fine, fixable, missing: the shape tells them apart, not only the colour. */
export function HealthIcon({ health }: { health: Health }) {
  return (
    <span class={`health health-${health}`}>
      <Icon>
        {health === 'fine' && <path d="M3.2 8.4l3 3 6.6-6.8" />}
        {health === 'fixable' && (
          <path d="M13 3.5a3.2 3.2 0 0 1-4.3 4.2L4.4 12a1.3 1.3 0 0 1-1.9-1.9l4.3-4.3A3.2 3.2 0 0 1 11 1.5L9 3.6l.5 1.9 1.9.5z" />
        )}
        {health === 'missing' && (
          <>
            <path d="M8 1.8l6.4 11.4H1.6z" />
            <path d="M8 6.4v3.2M8 11.4v.2" />
          </>
        )}
      </Icon>
    </span>
  )
}
