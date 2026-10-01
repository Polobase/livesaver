import { describe, expect, test } from 'bun:test'
import { decodeUtf8, type El, encodeUtf8, patch, scan } from '../src/index.js'

/** Small deterministic PRNG (mulberry32) so failures are reproducible from the seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NAMES = ['FileRef', 'Path', 'Name', 'Café', 'Tempo', 'Manual', 'Buffer', 'X']
const VALUES = [
  '',
  'a',
  'Kick & Snare',
  'say "hi"',
  "it's",
  '<tag>',
  'É € 🎹',
  '../x/y.wav',
  '  spaced  ',
]

function randomDoc(r: () => number): string {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T
  const esc = (v: string, q: string) =>
    v
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll(q, q === '"' ? '&quot;' : '&apos;')
  const el = (depth: number, indent: string): string => {
    const name = pick(NAMES)
    const attrs: string[] = []
    const used = new Set<string>()
    for (let i = Math.floor(r() * 3); i > 0; i--) {
      const attr = pick(['Value', 'Id', 'Dir'])
      if (used.has(attr)) continue
      used.add(attr)
      const q = r() < 0.2 ? "'" : '"'
      attrs.push(` ${attr}=${q}${esc(pick(VALUES), q)}${q}`)
    }
    if (depth > 3 || r() < 0.4) return `${indent}<${name}${attrs.join('')} />`
    const kids: string[] = []
    for (let i = Math.floor(r() * 4); i > 0; i--) kids.push(el(depth + 1, `${indent}\t`))
    if (kids.length === 0)
      return `${indent}<${name}${attrs.join('')}>${esc(pick(VALUES), '"')}</${name}>`
    return `${indent}<${name}${attrs.join('')}>\n${kids.join('\n')}\n${indent}</${name}>`
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Root>\n${el(0, '\t')}\n${el(0, '\t')}\n</Root>\n`
}

describe('property: edits change exactly the edited attribute values', () => {
  for (let seed = 1; seed <= 300; seed++) {
    test(`seed ${seed}`, () => {
      const r = rng(seed)
      const source = randomDoc(r)
      const ix = scan(encodeUtf8(source))
      expect(patch(ix).apply()).toEqual(ix.bytes)

      const withValue: El[] = []
      for (let i = 0; i < ix.count; i++) if (ix.attrSpan(i as El, 'Value')) withValue.push(i as El)
      const chosen = withValue.filter(() => r() < 0.3)
      const p = patch(ix, { quoting: r() < 0.5 ? 'double' : 'live' })
      const expected = new Map<number, string>()
      for (const el of chosen) {
        const value = VALUES[Math.floor(r() * VALUES.length)] as string
        p.setAttr(el, 'Value', value)
        expected.set(el, value)
      }
      const { index: out } = p.applyChecked()

      expect(out.count).toBe(ix.count)
      for (let i = 0; i < ix.count; i++) {
        const el = i as El
        expect(out.name(el)).toBe(ix.name(el))
        const want = expected.get(i)
        for (const attr of ix.attrNames(el)) {
          if (attr === 'Value' && want !== undefined) expect(out.attr(el, attr)).toBe(want)
          else expect(out.attr(el, attr)).toBe(ix.attr(el, attr) as string)
        }
      }
      // Outside the edited value spans, every byte is unchanged.
      const edits = p.edits()
      const before = decodeUtf8(ix.bytes)
      const after = decodeUtf8(p.apply())
      let rebuilt = ''
      let pos = 0
      for (const e of edits) {
        rebuilt += decodeUtf8(ix.bytes.subarray(pos, e.start)) + e.text
        pos = e.end
      }
      rebuilt += decodeUtf8(ix.bytes.subarray(pos))
      expect(after).toBe(rebuilt)
      if (edits.length === 0) expect(after).toBe(before)
    })
  }
})
