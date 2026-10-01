/**
 * Finder comments through AppleScript. Finder shows a comment from the parent folder's `.DS_Store`,
 * so it can only be set through Finder itself; the first call makes macOS ask once whether the
 * terminal may control Finder. Items go in batches of 100 per osascript call.
 */
import { spawn } from 'node:child_process'
import { FinderAccessError, type FinderComments, nfc } from '@livesaver/core'

export const BATCH = 100
/** Between comments in the output of the read script. */
export const SEPARATOR = '\x1e'

export const READ_SCRIPT = `on run argv
    set out to {}
    repeat with p in argv
        try
            set a to (POSIX file (contents of p)) as alias
            tell application "Finder" to set c to comment of a
            if c is missing value then set c to ""
            set end of out to c
        on error errText number errNum
            if errNum is -1743 then error errText number errNum
            set end of out to ""
        end try
    end repeat
    set AppleScript's text item delimiters to (character id ${SEPARATOR.charCodeAt(0)})
    return out as text
end run
`

export const WRITE_SCRIPT = `on run argv
    repeat with i from 1 to (count argv) by 2
        set a to (POSIX file (item i of argv)) as alias
        tell application "Finder" to set comment of a to (item (i + 1) of argv)
    end repeat
end run
`

export interface ScriptResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** Runs an AppleScript with arguments (tests pass a fake that keeps comments in memory). */
export type ScriptRunner = (script: string, args: readonly string[]) => Promise<ScriptResult>

export const osascript: ScriptRunner = (script, args) =>
  new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/osascript', ['-e', script, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (d: string) => {
      stdout += d
    })
    child.stderr.setEncoding('utf8').on('data', (d: string) => {
      stderr += d
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })

export class FinderScriptComments implements FinderComments {
  private readonly runner: ScriptRunner
  private readonly batch: number

  constructor(runner: ScriptRunner = osascript, batch = BATCH) {
    this.runner = runner
    this.batch = batch
  }

  private async run(script: string, args: readonly string[]): Promise<string> {
    const r = await this.runner(script, args)
    if (r.code !== 0) {
      const message = r.stderr.trim()
      if (message.includes('-1743')) throw new FinderAccessError('permission', message)
      throw new FinderAccessError('failed', message || `osascript exit ${r.code}`)
    }
    return r.stdout
  }

  async read(paths: readonly string[]): Promise<Map<string, string>> {
    const comments = new Map<string, string>()
    for (let i = 0; i < paths.length; i += this.batch) {
      const batch = paths.slice(i, i + this.batch)
      let out = await this.run(READ_SCRIPT, batch)
      if (out.endsWith('\n')) out = out.slice(0, -1)
      const values = out.split(SEPARATOR)
      if (values.length !== batch.length)
        throw new FinderAccessError('mismatch', `${values.length}/${batch.length}`)
      batch.forEach((p, k) => {
        comments.set(p, nfc(values[k] as string))
      })
    }
    return comments
  }

  async write(comments: ReadonlyMap<string, string>): Promise<void> {
    const items = [...comments]
    for (let i = 0; i < items.length; i += this.batch) {
      await this.run(WRITE_SCRIPT, items.slice(i, i + this.batch).flat())
    }
  }
}
