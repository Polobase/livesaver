/** What `auval -a` prints: the Audio Units registered with macOS. */
import { pyStrip } from '@livesaver/core'
import type { AuComponent } from './inventory.js'

// biome-ignore lint/suspicious/noControlCharactersInRegex: the separators of Python's str.splitlines()
const LINE_BREAKS = /\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/

/** Lines of `auval -a`: "aufx dely appl  -  Apple: AUDelay" → [type, subtype, manufacturer, name]. */
export function parseAuval(output: string): AuComponent[] {
  const found: AuComponent[] = []
  for (const line of output.split(LINE_BREAKS)) {
    const c = Array.from(line)
    if (c.length > 19 && c[4] === ' ' && c[9] === ' ' && c.slice(14, 19).join('') === '  -  ') {
      const name = pyStrip(
        c
          .slice(19)
          .join('')
          .replace(/\s{2,}Cannot open component.*$/, ''),
      )
      found.push([c.slice(0, 4).join(''), c.slice(5, 9).join(''), c.slice(10, 14).join(''), name])
    }
  }
  return found
}
