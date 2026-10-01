import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import {
  casefold,
  codePointLength,
  compareCodePoints,
  compareMinorVersion,
  norm,
  posix,
  pyInt,
  pyStrip,
  resizedHeaderCrcs,
} from '../src/index.js'

const TRICKY = [
  'Bass ß.wav',
  'KICK 01.WAV',
  '  SP_Hi_Hat_9_707.wav',
  'CLAP:SNARE.wav',
  'É.wav',
  'E\u0301.wav',
  'İstanbul',
  'ǅungla',
  'ﬁle.aif',
  'ΣΑΣ',
  '𐐀 deseret',
  '\u00a0nbsp\u00a0',
  '\u001ctrailing\u001f',
  '\ufeffbom',
  'ẞ',
  'ŉ',
  'Ꭰ',
  'Ⅷ',
  'Ⓐ',
  '',
]

const python = spawnSync('python3', ['--version']).status === 0

describe('Python compatibility', () => {
  test('casefold differs from toLowerCase where Python does', () => {
    expect(casefold('Bass ß')).toBe('bass ss')
    expect(casefold('ẞ')).toBe('ss')
    expect(casefold('ﬁ')).toBe('fi')
    expect(casefold('ABC')).toBe('abc')
  })

  test('pyStrip follows str.isspace, not trim()', () => {
    expect(pyStrip('\u001cx\u001f')).toBe('x')
    expect(pyStrip('\ufeffx')).toBe('\ufeffx')
    expect(pyStrip('\u0085 x \u3000')).toBe('x')
  })

  test('pyInt', () => {
    expect(pyInt('17226')).toBe(17226)
    expect(pyInt(' 12 ')).toBe(12)
    expect(pyInt('1_000')).toBe(1000)
    expect(pyInt('-5')).toBe(-5)
    expect(pyInt('12abc')).toBe(0)
    expect(pyInt('')).toBe(0)
  })

  test('code points', () => {
    expect(codePointLength('a🎹b')).toBe(3)
    expect(compareCodePoints('\uffff', '🎹')).toBe(-1)
    expect('\uffff' < '🎹').toBe(false)
    expect(compareCodePoints('a', 'b')).toBe(-1)
    expect(compareCodePoints('ab', 'a')).toBe(1)
  })

  ;(python ? test : test.skip)("norm() equals Python's casefold for tricky names", () => {
    const script =
      'import json,sys,unicodedata\n' +
      'print(json.dumps([unicodedata.normalize("NFC", t).casefold().replace(":", "_").strip() for t in json.load(sys.stdin)]))'
    const out = spawnSync('python3', ['-c', script], {
      input: JSON.stringify(TRICKY),
      encoding: 'utf8',
    })
    expect(out.status).toBe(0)
    expect(TRICKY.map(norm)).toEqual(JSON.parse(out.stdout))
  })
})

describe('posix paths (Python posixpath semantics)', () => {
  test('normpath', () => {
    expect(posix.normpath('/a/b/../c/./d/')).toBe('/a/c/d')
    expect(posix.normpath('//a')).toBe('//a')
    expect(posix.normpath('///a')).toBe('/a')
    expect(posix.normpath('../a/../../b')).toBe('../../b')
    expect(posix.normpath('')).toBe('.')
  })

  test('join, dirname, basename, splitext', () => {
    expect(posix.join('/a', 'b', '/c', 'd')).toBe('/c/d')
    expect(posix.join('/a/', 'b')).toBe('/a/b')
    expect(posix.dirname('/a/b/')).toBe('/a/b')
    expect(posix.dirname('/a')).toBe('/')
    expect(posix.dirname('a')).toBe('')
    expect(posix.basename('/a/b.wav')).toBe('b.wav')
    expect(posix.splitext('/x/.hidden')).toEqual(['/x/.hidden', ''])
    expect(posix.splitext('/x/a.b.wav')).toEqual(['/x/a.b', '.wav'])
    expect(posix.splitext('/x/..wav')).toEqual(['/x/..wav', ''])
  })

  test('relpath and commonpath', () => {
    expect(posix.relpath('/p/Samples/Imported/1.wav', '/p')).toBe('Samples/Imported/1.wav')
    expect(posix.relpath('/a/x/1.wav', '/a/b/c')).toBe('../../x/1.wav')
    expect(posix.relpath('/a', '/a')).toBe('.')
    expect(posix.commonpath(['/a/b/c', '/a/b/d', '/a/bx'])).toBe('/a')
  })

  test('splitPath handles Windows paths', () => {
    expect(posix.splitPath('E:\\Samples\\Lib1\\Kick\\1.wav')).toEqual([
      'E:',
      'Samples',
      'Lib1',
      'Kick',
      '1.wav',
    ])
    expect(posix.isWindowsPath('E:\\x')).toBe(true)
    expect(posix.isWindowsPath('/Users/x')).toBe(false)
  })
})

describe('versions and vendor CRCs', () => {
  test('compareMinorVersion', () => {
    expect(compareMinorVersion('10.0_370', '10.0_377')).toBeLessThan(0)
    expect(compareMinorVersion('11.0_433', '10.0_377')).toBeGreaterThan(0)
    expect(compareMinorVersion('10.0_377', '10.0_377')).toBe(0)
    expect(compareMinorVersion('9.5_327', '10.0_377')).toBeLessThan(0)
  })

  test('resizedHeaderCrcs only for RIFF/FORM', () => {
    const head = new Uint8Array(64)
    head.set([0x52, 0x49, 0x46, 0x46])
    expect(resizedHeaderCrcs(head, 1000).size).toBe(3)
    expect(resizedHeaderCrcs(new Uint8Array(64), 1000).size).toBe(0)
  })
})
