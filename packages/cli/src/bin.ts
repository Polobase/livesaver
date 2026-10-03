#!/usr/bin/env node
import { format } from 'node:util'
import { main } from './main.js'

// Under Bun, `console.log` writes straight to the file descriptor, and once `process.stdout` was
// looked at (the colour library asks it whether it is a terminal) that descriptor no longer
// blocks: what a pipe cannot take at once (64 KB) is dropped, so `--json | jq` got half a
// document. The stream waits for the reader, and the process for the stream.
console.log = (...args: unknown[]) => {
  process.stdout.write(`${format(...args)}\n`)
}

// node:sqlite (reading Live's plug-in database under Node) announces itself as experimental on
// every run; that notice is meant for developers, not for livesaver's users.
const emitWarning = process.emitWarning.bind(process)
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  if (String(warning).includes('SQLite is an experimental feature')) return
  return (emitWarning as (w: string | Error, ...r: unknown[]) => void)(warning, ...rest)
}) as typeof process.emitWarning

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
