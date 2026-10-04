/**
 * The two ways a page of a site can fix, said for the browser at hand: connected to livesaver
 * on this computer, or editing the folder itself. Browsers differ in both, and one that keeps a
 * page from either says nothing to its user. So the page says which step this browser needs,
 * and names the browser's own setting for it.
 */
import { canWriteHere } from '../engine/storage.js'

export interface BrowserFacts {
  readonly userAgent: string
  /** Brave says so itself (`navigator.brave`): its user agent is that of Chrome. */
  readonly brave: boolean
  /** The browser hands a page folders to edit, and gives it a storage of its own. */
  readonly canEdit: boolean
}

/** Browsers that differ in what they let a page do; the rest go by what they are built on. */
export type Browser = 'brave' | 'safari' | 'firefox' | 'chromium' | 'other'

export function browserOf(facts: Pick<BrowserFacts, 'userAgent' | 'brave'>): Browser {
  if (facts.brave) return 'brave'
  const agent = facts.userAgent
  // Every browser of an iPhone or iPad is Safari underneath, whatever it calls itself.
  if (/\b(iPhone|iPad|iPod)\b/.test(agent)) return 'safari'
  if (/\bFirefox\//.test(agent)) return 'firefox'
  // Chrome, Edge and the others built on Chromium also say "Safari".
  if (/Chrom(e|ium)\//.test(agent)) return 'chromium'
  if (/\bSafari\//.test(agent)) return 'safari'
  return 'other'
}

/** Works as it is; works after a step in the browser's own settings; not in this browser. */
export type WayState = 'works' | 'step' | 'no'

export interface Way {
  readonly state: WayState
  /** What this browser does about it, and what its user does. */
  readonly text: string
  /**
   * The page of the browser's own settings the step is taken on. A page of a site cannot link
   * to such an address: it is shown to be copied.
   */
  readonly address?: string
}

export interface Ways {
  readonly browser: Browser
  /** As said to its user ('' = a browser that is not named: "your browser"). */
  readonly name: string
  /** A page of a site reaching livesaver on this computer (`livesaver web --pair`). */
  readonly connect: Way
  /** The page editing a folder itself (fixing in the browser). */
  readonly edit: Way
}

/** Where Brave lists the sites that may reach this computer. */
export const BRAVE_LOCALHOST = 'brave://settings/content/localhostAccess'
/** Brave's switch for what Chrome and Edge do as they are: letting a page edit a folder. */
export const BRAVE_FOLDERS = 'brave://flags/#file-system-access-api'

const NAMES: Readonly<Record<Browser, string>> = {
  brave: 'Brave',
  safari: 'Safari',
  firefox: 'Firefox',
  chromium: '',
  other: '',
}

function connectIn(browser: Browser): Way {
  if (browser === 'brave')
    return {
      state: 'step',
      text: 'Brave keeps a site from reaching your computer, and does not ask. Allow it once: open Brave’s setting for it, and add this site to the sites that are allowed.',
      address: BRAVE_LOCALHOST,
    }
  if (browser === 'safari')
    return {
      state: 'no',
      text: 'Safari does not let a page of a site reach your computer. Use the app that “livesaver web” opens itself.',
    }
  return {
    state: 'works',
    text: 'Your browser may ask whether this page may reach your computer: allow it.',
  }
}

function editIn(browser: Browser, canEdit: boolean): Way {
  if (canEdit)
    return {
      state: 'works',
      text: 'Your browser can let this page edit a folder you choose.',
    }
  if (browser === 'brave')
    return {
      state: 'step',
      text: 'Brave lets a page edit a folder only once you switch that on: open Brave’s flag for it, choose “Enabled”, and restart Brave.',
      address: BRAVE_FOLDERS,
    }
  return {
    state: 'no',
    text:
      // (One built on Chromium that hands out no folder: an old one, or a page of an address
      // that is not secure. It may be Chrome itself.)
      browser === 'chromium'
        ? 'This browser does not let this page edit a folder.'
        : `${NAMES[browser] || 'This browser'} does not let a page edit a folder. Chrome and Edge do.`,
  }
}

/** What each way needs in a browser. */
export function waysOf(facts: BrowserFacts): Ways {
  const browser = browserOf(facts)
  return {
    browser,
    name: NAMES[browser],
    connect: connectIn(browser),
    edit: editIn(browser, facts.canEdit),
  }
}

/** This browser, as far as a page can tell. */
export function browserFacts(): BrowserFacts {
  const browser = globalThis.navigator as (Navigator & { brave?: unknown }) | undefined
  return {
    userAgent: browser?.userAgent ?? '',
    brave: browser?.brave !== undefined,
    canEdit: canWriteHere(),
  }
}

/**
 * What a connected page says when its livesaver does not answer. A browser that keeps a page of
 * a site from reaching this computer says nothing, and to the page that is the same as a
 * livesaver that is gone: so both are said, the first for the browser at hand. `site` is where
 * the page is from (its origin): what a browser's setting wants to be told.
 */
export function unreachableAdvice(ways: Ways, site: string): string[] {
  const again =
    'If it was stopped, start it again with “livesaver web --pair”, which connects this page anew.'
  if (ways.browser === 'brave')
    return [
      `If livesaver runs, Brave keeps this page from reaching it until you allow that: open Brave’s setting for it, add ${site} to the sites that are allowed, and reload this page. Or open the app from this computer, which needs no permission.`,
      again,
    ]
  if (ways.browser === 'safari')
    return [
      'Safari keeps a page of a site from reaching livesaver: open the app from this computer, which works in every browser.',
      // (Connecting anew would end here again.)
      'If livesaver was stopped, start it again with “livesaver web”: it opens the app from this computer.',
    ]
  return [
    'If livesaver runs, your browser may keep this page from reaching it (Safari does, and Brave until you allow it): open the app from this computer, which works in every browser.',
    again,
  ]
}
