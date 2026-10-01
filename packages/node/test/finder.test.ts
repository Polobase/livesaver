/** Finder tags (extended attributes) and comments (AppleScript). */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  COMMENT_ATTR,
  decodeComment,
  decodeTags,
  encodeBinaryPlist,
  encodeTags,
  FinderAccessError,
  mergedTags,
  TAGS_ATTR,
  type Tag,
} from '@livesaver/core'
import { applyWriter, Probe } from '@livesaver/ops'
import {
  fakeOsascript,
  makeProject,
  OLD_SET,
  tempDir,
  writeFile,
  writeSet,
} from '@livesaver/test-kit'
import { createNodeHost, createXattr, FinderScriptComments } from '../src/index.js'

const darwin = process.platform === 'darwin'
const onMac = darwin ? describe : describe.skip
const xattr = createXattr()

async function readTags(path: string): Promise<Tag[]> {
  return decodeTags(await xattr?.get(path, TAGS_ATTR))
}

async function writeTags(path: string, tags: readonly Tag[]): Promise<void> {
  if (tags.length) await xattr?.set(path, TAGS_ATTR, encodeTags(tags))
  else await xattr?.remove(path, TAGS_ATTR)
}

let tmp: { path: string; cleanup: () => void }
beforeEach(() => {
  tmp = tempDir()
})
afterEach(() => tmp.cleanup())

onMac('tags (TagsTest)', () => {
  test('round trip on files and folders', async () => {
    const file = writeFile(join(tmp.path, 'Café Demo.als'), 'x')
    const folder = makeProject(tmp.path, 'Café Demo')
    for (const item of [file, folder]) {
      expect(await readTags(item)).toEqual([])
      await writeTags(item, [
        ['Sketch', 0],
        ['Samples missing', 7],
      ])
      expect(await readTags(item)).toEqual([
        ['Sketch', 0],
        ['Samples missing', 7],
      ])
      await writeTags(item, [])
      expect(await xattr?.get(item, TAGS_ATTR)).toBeUndefined()
    }
  })

  test('tags Finder wrote without colour', async () => {
    const path = writeFile(join(tmp.path, 'a.als'), 'x')
    await xattr?.set(path, TAGS_ATTR, encodeBinaryPlist(['Continue', 'Red\n6']))
    expect(await readTags(path)).toEqual([
      ['Continue', 0],
      ['Red', 6],
    ])
  })

  test('decomposed accents are read composed', async () => {
    const path = writeFile(join(tmp.path, 'a.als'), 'x')
    await xattr?.set(path, TAGS_ATTR, encodeBinaryPlist(['Cafe\u0301\n6']))
    expect(await readTags(path)).toEqual([['Caf\u00e9', 6]])
  })

  test('only managed tags are replaced', () => {
    const current: Tag[] = [
      ['Continue', 2],
      ['Sketch', 0],
      ['4★', 0],
    ]
    expect(mergedTags(current, new Set(['Sketch', 'Arranged']), [['Arranged', 0]])).toEqual([
      ['Continue', 2],
      ['4★', 0],
      ['Arranged', 0],
    ])
  })

  test('a rewritten set keeps its tags and comment; the backup stays untagged', async () => {
    const project = makeProject(tmp.path, 'Tagged')
    const path = join(project, 'Tagged.als')
    writeSet(path, OLD_SET)
    await writeTags(path, [['Continue', 2]])
    await xattr?.set(path, COMMENT_ATTR, encodeBinaryPlist('good bassline'))
    const host = createNodeHost({ write: true, trashDir: join(tmp.path, 'Trash') })
    const probe = new Probe(host.fs, host.hash)
    const writer = applyWriter(host, { id: 'x', dir: join(tmp.path, 'run') }, probe)
    const backup = await writer.writeSet(path, project, new TextEncoder().encode(OLD_SET))
    expect(await readTags(path)).toEqual([['Continue', 2]])
    expect(decodeComment(await xattr?.get(path, COMMENT_ATTR))).toBe('good bassline')
    expect(await readTags(backup)).toEqual([]) // backups stay untagged, Finder searches find the set only
  })
})

describe('comments (CommentsTest)', () => {
  test('read and write in batches', async () => {
    const paths = [0, 1, 2, 3, 4].map((i) => `/p/${i}.als`)
    const fake = fakeOsascript({
      '/p/1.als': 'one',
      '/p/4.als': 'Sketch · 1:00 ‖ with\nline break',
    })
    const finder = new FinderScriptComments(fake.runner, 2)
    const comments = await finder.read(paths)
    await finder.write(
      new Map([
        ['/p/0.als', 'new'],
        ['/p/2.als', 'also new'],
        ['/p/3.als', ''],
      ]),
    )
    expect(Object.fromEntries(comments)).toEqual({
      '/p/0.als': '',
      '/p/1.als': 'one',
      '/p/2.als': '',
      '/p/3.als': '',
      '/p/4.als': 'Sketch · 1:00 ‖ with\nline break',
    })
    expect(fake.calls.slice(3)).toEqual([
      ['/p/0.als', 'new', '/p/2.als', 'also new'],
      ['/p/3.als', ''],
    ])
    expect(fake.comments.get('/p/2.als')).toBe('also new')
  })

  test('missing permission', async () => {
    const fake = fakeOsascript(
      {},
      'execution error: Not authorized to send Apple events to Finder. (-1743)',
    )
    const error = await new FinderScriptComments(fake.runner).read(['/p/a.als']).catch((e) => e)
    expect(error).toBeInstanceOf(FinderAccessError)
    expect((error as FinderAccessError).kind).toBe('permission')
  })

  ;(darwin ? test : test.skip)('the comment attribute', async () => {
    const path = writeFile(join(tmp.path, 'a.als'), 'x')
    expect(decodeComment(await xattr?.get(path, COMMENT_ATTR))).toBe('')
    await xattr?.set(path, COMMENT_ATTR, encodeBinaryPlist('note'))
    expect(decodeComment(await xattr?.get(path, COMMENT_ATTR))).toBe('note')
  })
})
