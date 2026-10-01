/**
 * Property lists, Mach-O headers, CSV and Python number formatting, checked against values
 * produced by Python 3.14 (`plistlib`, `csv`, `format(x, 'g')`, `round`).
 */
import { describe, expect, test } from 'bun:test'
import {
  csvLine,
  csvRecords,
  decodeComment,
  decodeTags,
  encodeBinaryPlist,
  encodeTags,
  formatCsv,
  machoArchs,
  mergedTags,
  parseCsv,
  parsePlist,
  pyG,
  pyRound,
  pyRoundTo,
  sameTags,
  sniffDelimiter,
} from '../src/index.js'

const hex = (data: Uint8Array) => Buffer.from(data).toString('hex')
const unhex = (text: string) => new Uint8Array(Buffer.from(text, 'hex'))

const PY_TAGS =
  '62706c6973743030a40102030158536b657463680a305f101153616d706c6573206d697373696e670a376400342605000a0036080d162a0000000000000101000000000000000400000000000000000000000000000033'
const PY_COMMENT =
  '62706c69737430305d676f6f6420626173736c696e65080000000000000101000000000000000100000000000000000000000000000016'
const PY_DICT =
  '62706c6973743030d40102030405060d0e51615162546c6f6e676100e95178a60708090a0b0c1001110100120001117013ffffffffffffffff09085f10147979797979797979797979797979797979797979420001081113151a1d1f26282b30393a3b520000000000000101000000000000000f00000000000000000000000000000055'

describe('binary plists (plistlib parity)', () => {
  test('Finder tags are written byte for byte like plistlib, repeated names shared', () => {
    const tags = [
      ['Sketch', 0],
      ['Samples missing', 7],
      ['4★', 6],
      ['Sketch', 0],
    ] as const
    expect(hex(encodeTags(tags))).toBe(PY_TAGS)
    expect(decodeTags(unhex(PY_TAGS))).toEqual(tags.map((t) => [...t]))
  })

  test('strings, dictionaries, numbers, booleans and data', () => {
    expect(hex(encodeBinaryPlist('good bassline'))).toBe(PY_COMMENT)
    const value = {
      b: [1, 256, 70000, -1, true, false],
      a: 'x',
      é: new Uint8Array([0, 1]),
      long: 'y'.repeat(20),
    }
    expect(hex(encodeBinaryPlist(value))).toBe(PY_DICT)
    const back = parsePlist(unhex(PY_DICT)) as Record<string, unknown>
    expect(back.b).toEqual([1, 256, 70000, -1, true, false])
    expect(back.a).toBe('x')
    expect(back.é).toEqual(new Uint8Array([0, 1]))
  })

  test('large arrays use two-byte references', () => {
    const tags = Array.from({ length: 300 }, (_, i) => [`Tag${i}`, i % 8] as const)
    const data = encodeTags(tags)
    expect(hex(data).slice(0, 24)).toBe('62706c6973743030af11012c')
    expect(decodeTags(data)).toHaveLength(300)
    expect(decodeTags(data)[299]).toEqual(['Tag299', 3])
  })

  test('tags Finder wrote without colour, decomposed accents, garbage', () => {
    const data = encodeBinaryPlist(['Continue', 'Red\n6', 'Cafe\u0301\n6'])
    expect(decodeTags(data)).toEqual([
      ['Continue', 0],
      ['Red', 6],
      ['Caf\u00e9', 6],
    ])
    expect(decodeTags(new TextEncoder().encode('no plist'))).toEqual([])
    expect(decodeTags(undefined)).toEqual([])
  })

  test('comments: plist string, plain text, none', () => {
    expect(decodeComment(unhex(PY_COMMENT))).toBe('good bassline')
    expect(decodeComment(new TextEncoder().encode('plain note'))).toBe('plain note')
    expect(decodeComment(undefined)).toBe('')
  })

  test('only managed tags are replaced', () => {
    const current = [
      ['Continue', 2],
      ['Sketch', 0],
      ['4★', 0],
    ] as const
    expect(mergedTags(current, new Set(['Sketch', 'Arranged']), [['Arranged', 0]])).toEqual([
      ['Continue', 2],
      ['4★', 0],
      ['Arranged', 0],
    ])
    expect(
      sameTags(
        [
          ['a', 1],
          ['b', 0],
        ],
        [
          ['b', 0],
          ['a', 1],
        ],
      ),
    ).toBe(true)
    expect(sameTags([['a', 1]], [['a', 2]])).toBe(false)
  })
})

describe('XML plists', () => {
  test('an Info.plist with Audio Units', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleExecutable</key>
	<string>Serum</string>
	<!-- a comment -->
	<key>AudioComponents</key>
	<array>
		<dict>
			<key>manufacturer</key><string>XFER</string>
			<key>name</key><string>Xfer Records: Serum &amp; more</string>
			<key>subtype</key><string>XfsX</string>
			<key>type</key><string>aumu</string>
			<key>version</key><integer>65536</integer>
			<key>sandboxSafe</key><true/>
		</dict>
	</array>
	<key>empty</key><string/>
	<key>data</key><data>AAEC</data>
	<key>hex</key><integer>0x10</integer>
</dict>
</plist>`
    const value = parsePlist(new TextEncoder().encode(xml)) as Record<string, unknown>
    expect(value.CFBundleExecutable).toBe('Serum')
    expect(value.AudioComponents).toEqual([
      {
        manufacturer: 'XFER',
        name: 'Xfer Records: Serum & more',
        subtype: 'XfsX',
        type: 'aumu',
        version: 65536,
        sandboxSafe: true,
      },
    ])
    expect(value.empty).toBe('')
    expect(value.data).toEqual(new Uint8Array([0, 1, 2]))
    expect(value.hex).toBe(16)
  })
})

describe('Mach-O', () => {
  const ARM64 = 0x0100000c
  const X86_64 = 0x01000007
  const thin = (cpu: number) => {
    const b = new Uint8Array(32)
    b.set([0xcf, 0xfa, 0xed, 0xfe])
    new DataView(b.buffer).setUint32(4, cpu, true)
    return b
  }
  const fat = (...cpus: number[]) => {
    const b = new Uint8Array(8 + cpus.length * 20)
    const v = new DataView(b.buffer)
    b.set([0xca, 0xfe, 0xba, 0xbe])
    v.setUint32(4, cpus.length)
    for (const [i, c] of cpus.entries()) v.setUint32(8 + i * 20, c)
    return b
  }
  test('architectures', () => {
    expect(machoArchs(thin(ARM64))).toEqual(new Set(['arm64']))
    expect(machoArchs(thin(X86_64))).toEqual(new Set(['x86_64']))
    expect(machoArchs(fat(X86_64, ARM64))).toEqual(new Set(['x86_64', 'arm64']))
    expect(
      machoArchs(new Uint8Array([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 0x34, ...new Uint8Array(40)])),
    ).toEqual(new Set())
    expect(machoArchs(new TextEncoder().encode('#!/bin/sh\n'))).toEqual(new Set())
  })
})

describe('CSV (csv module parity)', () => {
  test('writing', () => {
    const text = csvLine(['']) + csvLine(['a b', ' x', 'y"z', 'l\nm', '1.0', 2, '', 'x,y', 'r\rs'])
    expect(text).toBe('""\r\na b, x,"y""z","l\nm",1.0,2,,"x,y","r\rs"\r\n')
    expect(formatCsv([['a']])).toBe('\ufeffa\r\n')
  })

  test('reading with the delimiter a spreadsheet program chose', () => {
    const text =
      'Group;Project;Note\r\n"Rock;Pop";Song Project;"line\none ""quoted"""\r\n\r\nA;B\r\nx;"y"z;w\r\n'
    expect(sniffDelimiter(text)).toBe(';')
    expect(parseCsv(text, ';')).toEqual([
      ['Group', 'Project', 'Note'],
      ['Rock;Pop', 'Song Project', 'line\none "quoted"'],
      [],
      ['A', 'B'],
      ['x', 'yz', 'w'],
    ])
    const { header, records } = csvRecords(`\ufeff${text}`, ';')
    expect(header).toEqual(['Group', 'Project', 'Note'])
    expect(records[1]).toEqual({ Group: 'A', Project: 'B', Note: undefined })
    expect(sniffDelimiter('a,b;c\n')).toBe(',') // ties: the first of , ; tab
  })
})

describe('Python number formatting', () => {
  test("format(x, 'g')", () => {
    const cases: [number, string][] = [
      [0, '0'],
      [-0, '-0'],
      [1, '1'],
      [120, '120'],
      [128.5, '128.5'],
      [174.99, '174.99'],
      [999.99, '999.99'],
      [0.0001, '0.0001'],
      [0.00001234, '1.234e-05'],
      [123456, '123456'],
      [1234567, '1.23457e+06'],
      [1e21, '1e+21'],
      [1.5e-7, '1.5e-07'],
      [2.5, '2.5'],
      [1234565, '1.23456e+06'],
      [12345.25, '12345.2'],
      [0.1, '0.1'],
      [1 / 3, '0.333333'],
      [99.995, '99.995'],
      [1e16, '1e+16'],
      [123.456789, '123.457'],
    ]
    for (const [x, want] of cases) expect([x, pyG(x)]).toEqual([x, want])
  })

  test('round(x) and round(x, 2)', () => {
    const cases: [number, number][] = [
      [0.5, 0],
      [1.5, 2],
      [2.5, 2],
      [-0.5, -0],
      [-1.5, -2],
      [3.4999, 3],
      [191.5, 192],
      [192.5, 192],
      [1e15 + 0.5, 1e15],
    ]
    for (const [x, want] of cases)
      expect(pyRound(x) === want || (pyRound(x) === 0 && want === 0)).toBe(true)
    const tempo: [number, string][] = [
      [120.125, '120.12'],
      [120.135, '120.14'],
      [174.9999, '175'],
      [99.995, '100'],
      [0.005, '0.01'],
      [127.99999999, '128'],
      [86.0000001, '86'],
    ]
    for (const [x, want] of tempo) expect(pyG(pyRoundTo(x, 2))).toBe(want)
  })
})
