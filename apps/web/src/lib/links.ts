/**
 * The site with the guide. The app asks it for nothing: these are links for someone to follow,
 * which open in a tab of their own.
 */
const SITE = 'https://polobase.github.io/livesaver'

export const GUIDE = {
  start: `${SITE}/docs/guide/getting-started/`,
  /** How to get livesaver on one's own computer: what a page in a browser cannot do needs it. */
  install: `${SITE}/docs/guide/getting-started/#install-livesaver-on-your-mac`,
} as const

/** What a link to the guide looks like wherever the app says that something needs livesaver. */
export const GET_LIVESAVER = {
  label: 'How to get livesaver',
  to: GUIDE.install,
  target: '_blank',
  trailingIcon: 'i-lucide-arrow-up-right',
} as const
