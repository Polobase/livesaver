/** Which of Ableton's own folders a given folder holds, known as soon as it was given. */
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { join } from 'node:path'
import { pickedFolder, tempDir, uploadedFolder, writeFile } from '@livesaver/test-kit'
import { type FolderSource, holdsNames, holdsOf } from '../src/index.js'

let tmp: { path: string; cleanup: () => void }
beforeEach(() => {
  tmp = tempDir()
})
afterEach(() => tmp.cleanup())

/** A folder with these files, as an upload delivers it. */
function uploaded(name: string, files: string[]): FolderSource {
  for (const file of files) writeFile(join(tmp.path, name, file), 'x')
  return uploadedFolder(join(tmp.path, name))
}

const names = (source: FolderSource) => holdsNames(holdsOf(source))

test('the User Library and the Factory Packs are found in the folder that holds them', () => {
  const ableton = uploaded('Ableton', ['User Library/Samples/a.wav', 'Factory Packs/Pack/b.wav'])
  expect(names(ableton)).toEqual(['User Library', 'Factory Packs'])
  expect(names(uploaded('User Library', ['Samples/a.wav']))).toEqual(['User Library'])
  expect(names(uploaded('factory packs', ['Pack/b.wav']))).toEqual(['Factory Packs'])
})

test("Live's own content is found in the Live app, its Contents, App-Resources, or the Core Library", () => {
  const live = ["Live's own content"]
  const inApp = 'Contents/App-Resources/Core Library/Samples/c.wav'
  expect(names(uploaded('Ableton Live 12 Suite.app', [inApp, 'Contents/Info.plist']))).toEqual(live)
  expect(names(uploaded('Contents', ['App-Resources/Core Library/Samples/c.wav']))).toEqual(live)
  expect(names(uploaded('App-Resources', ['Core Library/Samples/c.wav']))).toEqual(live)
  expect(names(uploaded('Core Library', ['Samples/c.wav']))).toEqual(live)
})

test('other folders hold none of them, however their files are called', () => {
  const samples = uploaded('Samples', [
    'Drums/Core Library/c.wav',
    'My User Library.wav',
    'Applications/Live.app/Contents/App-Resources/Core Library/c.wav',
  ])
  expect(holdsOf(samples)).toEqual({ userLibrary: false, factoryPacks: false, live: false })
})

test('a dropped folder is judged by its paths, a handle is not judged before it is read', () => {
  const listing: FolderSource = {
    kind: 'listing',
    name: 'Ableton Live 12 Suite.app',
    paths: ['Contents/Info.plist', 'Contents/App-Resources/Core Library/Samples/c.wav'],
    open: async () => undefined,
  }
  expect(names(listing)).toEqual(["Live's own content"])
  uploaded('Ableton', ['User Library/Samples/a.wav'])
  expect(holdsOf(pickedFolder(join(tmp.path, 'Ableton')))).toBeUndefined()
})
