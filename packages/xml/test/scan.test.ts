import { describe, expect, test } from 'bun:test'
import { type El, encodeUtf8, scan, XmlSyntaxError } from '../src/index.js'

const doc = (s: string) => encodeUtf8(s)

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="12.0_12402" Creator="Ableton Live 12.4.6">
\t<LiveSet>
\t\t<SampleRef>
\t\t\t<FileRef>
\t\t\t\t<RelativePathType Value="1" />
\t\t\t\t<RelativePath Value="../Samples/Kick &amp; Snare.wav" />
\t\t\t\t<Path Value='/Users/me/say "hi".wav' />
\t\t\t</FileRef>
\t\t\t<LastModDate Value="1575302731" />
\t\t</SampleRef>
\t\t<Buffer>00AA11BB</Buffer>
\t</LiveSet>
</Ableton>
`

describe('scan', () => {
  const ix = scan(doc(SAMPLE))
  const liveSet = ix.child(ix.root, 'LiveSet') as El
  const sampleRef = ix.child(liveSet, 'SampleRef') as El
  const fileRef = ix.child(sampleRef, 'FileRef') as El

  test('builds the tree in document order', () => {
    expect(ix.name(ix.root)).toBe('Ableton')
    expect(ix.count).toBe(9)
    expect(ix.children(fileRef).map((e) => ix.name(e))).toEqual([
      'RelativePathType',
      'RelativePath',
      'Path',
    ])
    expect(ix.parent(fileRef)).toBe(sampleRef)
    expect(ix.parent(ix.root)).toBeUndefined()
    expect(ix.depth(fileRef)).toBe(3)
    expect(ix.nextSibling(fileRef)).toBe(ix.child(sampleRef, 'LastModDate') as El)
    expect(ix.nextSibling(ix.child(sampleRef, 'LastModDate') as El)).toBeUndefined()
    expect(ix.contains(liveSet, fileRef)).toBe(true)
    expect(ix.contains(fileRef, liveSet)).toBe(false)
  })

  test('reads attributes in both quote styles and resolves entities', () => {
    expect(ix.attr(ix.root, 'MinorVersion')).toBe('12.0_12402')
    expect(ix.value(fileRef, 'RelativePath')).toBe('../Samples/Kick & Snare.wav')
    expect(ix.attrRaw(ix.find(fileRef, 'RelativePath') as El, 'Value')).toBe(
      '../Samples/Kick &amp; Snare.wav',
    )
    expect(ix.value(fileRef, 'Path')).toBe('/Users/me/say "hi".wav')
    expect(ix.attrQuote(ix.find(fileRef, 'Path') as El, 'Value')).toBe("'")
    expect(ix.attr(fileRef, 'Missing')).toBeUndefined()
    expect(ix.attrNames(ix.root)).toEqual(['MajorVersion', 'MinorVersion', 'Creator'])
  })

  test('finds by path, name and descendant', () => {
    expect(ix.find(ix.root, 'LiveSet/SampleRef/FileRef/Path')).toBe(ix.child(fileRef, 'Path') as El)
    expect(ix.find(ix.root, 'LiveSet/Nope/Path')).toBeUndefined()
    expect(ix.all('RelativePathType')).toHaveLength(1)
    expect(ix.all('NotThere')).toEqual([])
    expect(ix.firstDescendant(liveSet, 'Path')).toBe(ix.child(fileRef, 'Path') as El)
    expect(ix.descendants(sampleRef).length).toBe(5)
  })

  test('spans, text and indentation', () => {
    const buffer = ix.child(liveSet, 'Buffer') as El
    expect(ix.text(buffer)).toBe('00AA11BB')
    expect(ix.isSelfClosing(buffer)).toBe(false)
    const path = ix.child(fileRef, 'Path') as El
    expect(ix.isSelfClosing(path)).toBe(true)
    expect(ix.slice(ix.span(path))).toBe(`<Path Value='/Users/me/say "hi".wav' />`)
    expect(ix.indent(path)).toBe('\t\t\t\t')
    expect(
      ix
        .slice(ix.inner(ix.child(sampleRef, 'FileRef') as El))
        .trim()
        .startsWith('<RelativePathType'),
    ).toBe(true)
  })

  test('skips comments, CDATA, processing instructions, DOCTYPE and a BOM', () => {
    const bytes = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...doc(
        `<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x "y">]><!-- <b> --><a><![CDATA[<c>]]><d/></a>`,
      ),
    ])
    const i = scan(bytes)
    expect(i.name(i.root)).toBe('a')
    expect(i.children(i.root).map((e) => i.name(e))).toEqual(['d'])
  })

  test('handles non-ASCII names and values', () => {
    const i = scan(doc('<Café Valué="É &#x20AC; &#8364;"/>'))
    expect(i.name(i.root)).toBe('Café')
    expect(i.attr(i.root, 'Valué')).toBe('É € €')
  })

  const bad: [string, string][] = [
    ['<a><b></a>', 'mismatched end tag'],
    ['<a x="<"/>', 'lt in attribute'],
    ['<a x="1"y="2"/>', 'no space between attributes'],
    ['<a/>text', 'text after root'],
    ['<a/><b/>', 'two roots'],
    ['<a>', 'unclosed'],
    ['', 'empty'],
    ['<a x=1/>', 'unquoted attribute'],
    ['<a x="1/>', 'unterminated value'],
    ['</a>', 'end tag first'],
  ]
  for (const [xml, why] of bad) {
    test(`strict mode rejects: ${why}`, () => {
      expect(() => scan(doc(xml))).toThrow(XmlSyntaxError)
    })
  }

  test('lenient mode accepts what only strict rejects', () => {
    expect(scan(doc('<a><b></c></a>'), { strict: false }).count).toBe(2)
    expect(scan(doc('<a/>junk'), { strict: false }).count).toBe(1)
  })

  test('reports the byte offset of the problem', () => {
    try {
      scan(doc('<a><b></c></a>'))
      throw new Error('expected XmlSyntaxError')
    } catch (e) {
      expect(e).toBeInstanceOf(XmlSyntaxError)
      expect((e as XmlSyntaxError).offset).toBe(6)
    }
  })

  test('grows its tables for large documents', () => {
    const parts = ['<Root>']
    for (let i = 0; i < 50_000; i++) parts.push(`<E Id="${i}" Value="v${i}" />`)
    parts.push('</Root>')
    const i = scan(doc(parts.join('\n')))
    expect(i.count).toBe(50_001)
    const last = i.children(i.root).at(-1) as El
    expect(i.attr(last, 'Id')).toBe('49999')
  })
})
