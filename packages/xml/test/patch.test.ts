import { describe, expect, test } from 'bun:test'
import {
  decodeUtf8,
  type El,
  encodeUtf8,
  Patch,
  PatchConflictError,
  patch,
  scan,
  XmlSyntaxError,
} from '../src/index.js'

const SET = `<?xml version="1.0" encoding="UTF-8"?>
<Ableton Creator="Ableton Live 10.1.14">
\t<FileRef>
\t\t<RelativePath Value="old" />
\t\t<Path Value='a "quoted" name' />
\t\t<Remove Value="x" />
\t</FileRef>
</Ableton>
`

describe('patch', () => {
  const ix = scan(encodeUtf8(SET))
  const fileRef = ix.child(ix.root, 'FileRef') as El
  const rel = ix.child(fileRef, 'RelativePath') as El
  const path = ix.child(fileRef, 'Path') as El

  test('no edits → identical bytes', () => {
    const out = patch(ix).apply()
    expect(out).toEqual(ix.bytes)
  })

  test('setAttr writes double quotes and escapes', () => {
    const out = decodeUtf8(patch(ix).setAttr(rel, 'Value', 'Kick & "Snare" <1>.wav').apply())
    expect(out).toContain('<RelativePath Value="Kick &amp; &quot;Snare&quot; &lt;1&gt;.wav" />')
    expect(out.replace('Kick &amp; &quot;Snare&quot; &lt;1&gt;.wav', 'old')).toBe(SET)
  })

  test('live quoting uses single quotes for values with double quotes', () => {
    const out = decodeUtf8(
      new Patch(ix, { quoting: 'live' }).setAttr(path, 'Value', 'b "c"').apply(),
    )
    expect(out).toContain(`<Path Value='b "c"' />`)
    const double = decodeUtf8(patch(ix).setAttr(path, 'Value', 'b "c"').apply())
    expect(double).toContain('<Path Value="b &quot;c&quot;" />')
  })

  test('replace, insert and remove keep every other byte', () => {
    const remove = ix.child(fileRef, 'Remove') as El
    const p = patch(ix)
      .replace(rel, '<RelativePath Value="new" />')
      .insertAfter(path, '\n\t\t<Added Value="1" />')
      .remove(remove)
    const { bytes, index } = p.applyChecked()
    const out = decodeUtf8(bytes)
    expect(out).toBe(
      SET.replace('Value="old"', 'Value="new"')
        .replace(`name' />`, `name' />\n\t\t<Added Value="1" />`)
        .replace('\t\t<Remove Value="x" />\n', ''),
    )
    expect(index.value(index.child(index.root, 'FileRef') as El, 'Added')).toBe('1')
  })

  test('inserts at the same place keep their order', () => {
    const out = decodeUtf8(patch(ix).insertBefore(rel, 'A').insertBefore(rel, 'B').apply())
    expect(out).toContain('AB<RelativePath')
  })

  test('overlapping edits are rejected', () => {
    expect(() =>
      patch(ix).replace(fileRef, '<FileRef />').setAttr(rel, 'Value', 'x').apply(),
    ).toThrow(PatchConflictError)
  })

  test('applyChecked refuses a patch that breaks the XML', () => {
    expect(() => patch(ix).replace(rel, '<RelativePath Value="x">').applyChecked()).toThrow(
      XmlSyntaxError,
    )
  })

  test('setAttr on a missing attribute throws', () => {
    expect(() => patch(ix).setAttr(rel, 'Nope', 'x')).toThrow()
  })

  test('replaceInner changes element text', () => {
    const doc = scan(encodeUtf8('<a><Buffer>00AA</Buffer></a>'))
    const buffer = doc.child(doc.root, 'Buffer') as El
    expect(decodeUtf8(patch(doc).replaceInner(buffer, 'FFEE').apply())).toBe(
      '<a><Buffer>FFEE</Buffer></a>',
    )
  })
})
