import { spawn } from 'node:child_process'
import pc from 'picocolors'
import { absolute } from '../config.js'
import { startWeb } from '../web/server.js'

export interface WebFlags {
  readonly port?: string
  readonly open?: boolean
  readonly config?: string
}

/** `livesaver web`: the web app on this computer, until it is stopped. */
export async function runWeb(flags: WebFlags, version: string): Promise<number> {
  const port = Number(flags.port ?? 5173)
  let server: Awaited<ReturnType<typeof startWeb>>
  try {
    server = await startWeb({
      port,
      version,
      ...(flags.config ? { config: absolute(flags.config) } : {}),
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
  console.log(pc.dim('It runs until you stop it with Ctrl-C.'))
  if (flags.open !== false && process.platform === 'darwin')
    spawn('open', [server.url], { stdio: 'ignore', detached: true }).unref()
  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve)
    process.once('SIGTERM', resolve)
  })
  await server.close()
  return 0
}
