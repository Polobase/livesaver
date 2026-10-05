import { spawn } from 'node:child_process'
import pc from 'picocolors'
import { absolute } from '../config.js'
import { startWeb } from '../web/server.js'

export interface WebFlags {
  readonly port?: string
  readonly open?: boolean
  readonly config?: string
  /** Connect the app at this address (`true`: the one on livesaver's site) to this livesaver. */
  readonly pair?: string | boolean
}

/** L-I-V-E on a phone's keys: a port that other tools on a developer's computer leave alone. */
export const DEFAULT_PORT = 5483

/** The app on livesaver's site, which `--pair` connects to the livesaver of this computer. */
export const SITE_APP = 'https://polobase.github.io/livesaver/app/'

/**
 * The address that opens the app at `app` connected to the livesaver at `at`. Where livesaver
 * is and its token stand behind the `#`: that part of an address stays in the browser and is
 * not sent to the site.
 */
export function pairingLink(app: string, at: string, token: string): string {
  const page = app.endsWith('/') ? app : `${app}/`
  return `${page}#/connect?at=${encodeURIComponent(at.replace(/\/$/, ''))}&token=${token}`
}

/**
 * What to do when the page that `--pair` opened cannot reach this livesaver: some browsers keep
 * a page of a site from asking this computer for anything, and say nothing. The app at
 * livesaver's own address is the same one, and no browser keeps anyone from it.
 */
export function pairingHint(own: string): string[] {
  return [
    'If the page says that livesaver does not answer, the browser keeps it from reaching this computer:',
    '  Brave does until the site is allowed under brave://settings/content/localhostAccess, Safari always does.',
    `  The app at ${own} is the same one, and works in every browser.`,
  ]
}

/** `livesaver web`: the web app on this computer, until it is stopped. */
export async function runWeb(flags: WebFlags, version: string): Promise<number> {
  const port = Number(flags.port ?? DEFAULT_PORT)
  const app = flags.pair === true ? SITE_APP : flags.pair || undefined
  let site: string | undefined
  try {
    site = app === undefined ? undefined : new URL(app).origin
  } catch {
    console.error(`--pair takes the address of the app, e.g. ${SITE_APP}`)
    return 1
  }
  let server: Awaited<ReturnType<typeof startWeb>>
  try {
    server = await startWeb({
      port,
      version,
      ...(flags.config ? { config: absolute(flags.config) } : {}),
      ...(site ? { pair: site } : {}),
    })
  } catch (error) {
    const busy = (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
    console.error(
      busy
        ? `Port ${port} is in use (is the web app already running?). Try --port <number>.`
        : (error as Error).message,
    )
    return 1
  }
  console.log(`livesaver web app: ${server.url}`)
  // The app elsewhere, connected to this livesaver: only that site's pages are let in, and
  // only with the token of this link.
  const link = app === undefined ? undefined : pairingLink(app, server.url, server.token)
  if (link) {
    console.log(`Connected to it, the app at ${site}: ${link}`)
    // A browser that keeps a page of a site from reaching this computer says nothing of it.
    for (const line of pairingHint(server.url)) console.log(pc.dim(line))
  }
  console.log(pc.dim('It runs until you stop it with Ctrl-C.'))
  // (On Windows, File Explorer hands an address to the browser.)
  const opener = { darwin: 'open', win32: 'explorer.exe' }[process.platform as string]
  if (flags.open !== false && opener)
    spawn(opener, [link ?? server.url], { stdio: 'ignore', detached: true }).unref()
  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve)
    process.once('SIGTERM', resolve)
  })
  await server.close()
  return 0
}
