/**
 * A page that livesaver did not serve itself can be connected to the livesaver of this computer:
 * `livesaver web --pair` opens the app with where livesaver is and its token behind the `#` of
 * the address, which a browser keeps to itself. The pairing is kept for the tab, so that a
 * reload stays connected, and no longer.
 */

export interface Pairing {
  /** Where livesaver answers: `http://127.0.0.1:5483`. */
  readonly at: string
  readonly token: string
}

/** The part of a store (the tab's session storage) that is used. */
export interface PairingStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const KEY = 'livesaver-pairing'
const ROUTE = '#/connect?'
/** Only this computer: a link must never make the page talk to another machine. */
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}$/
const TOKEN = /^[0-9a-f]{32,128}$/

function valid(at: unknown, token: unknown): Pairing | undefined {
  if (typeof at !== 'string' || typeof token !== 'string') return undefined
  const address = at.replace(/\/$/, '')
  return LOCAL.test(address) && TOKEN.test(token) ? { at: address, token } : undefined
}

/** The pairing in the part of an address behind `#`, if that is one. */
export function pairingIn(hash: string): Pairing | undefined {
  if (!hash.startsWith(ROUTE)) return undefined
  const query = new URLSearchParams(hash.slice(ROUTE.length))
  return valid(query.get('at'), query.get('token'))
}

export function readPairing(store: PairingStore): Pairing | undefined {
  try {
    const kept = JSON.parse(store.getItem(KEY) ?? 'null') as Partial<Pairing> | null
    return valid(kept?.at, kept?.token)
  } catch {
    return undefined
  }
}

export function clearPairing(store: PairingStore): void {
  store.removeItem(KEY)
}

/**
 * Takes the pairing from the address the page was opened with, keeps it for the tab, and takes
 * it out of the address: the token should neither stay in view nor end up in a bookmark.
 */
export function takePairing(
  location: Pick<Location, 'hash' | 'pathname' | 'search'>,
  history: Pick<History, 'replaceState'>,
  store: PairingStore,
): Pairing | undefined {
  if (!location.hash.startsWith(ROUTE)) return undefined
  const pairing = pairingIn(location.hash)
  history.replaceState(null, '', `${location.pathname}${location.search}#/`)
  if (pairing) store.setItem(KEY, JSON.stringify(pairing))
  return pairing
}
