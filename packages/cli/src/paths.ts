/**
 * `node:path` as livesaver handles paths: `/` between the parts, on Windows too (`C:/Users/me`),
 * so that what the command line hands the pipeline reads the same on every system.
 */
import { nodePath } from '@livesaver/node'

export const {
  basename,
  dirname,
  extname,
  home,
  isAbsolute,
  join,
  relative,
  resolve,
  slashed,
  temp,
  windowsFolder,
} = nodePath
