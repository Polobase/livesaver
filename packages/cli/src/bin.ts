#!/usr/bin/env node
import { main } from './main.js'

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
