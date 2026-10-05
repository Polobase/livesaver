/**
 * What the Node host does on Windows, as far as it can be tried on another system: the places
 * Live keeps its folders in there (made up below a temporary folder), paths as livesaver handles
 * them, the list of what runs, and the names Windows does not make. The command line itself
 * runs on a Windows machine in CI (`packages/cli/test-node`).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir, writeFile } from '@livesaver/test-kit'
import {
  findLiveInstalls,
  liveInTaskList,
  nodePath,
  readLibraryConfig,
  refusedByWindows,
  WindowsFs,
} from '../src/index.js'

let tmp: { path: string; cleanup: () => void }
beforeEach(() => {
  tmp = tempDir()
})
afterEach(() => tmp.cleanup())

describe('paths', () => {
  test('a path of Windows is handed on with "/" and a capital drive; elsewhere "\\" is a sign of a name', () => {
    expect(nodePath.slashedFor('win32', 'c:\\Users\\me\\Music\\Song Project')).toBe(
      'C:/Users/me/Music/Song Project',
    )
    expect(nodePath.slashedFor('win32', 'D:/Samples\\Loops')).toBe('D:/Samples/Loops')
    expect(nodePath.slashedFor('darwin', '/Users/me/odd\\name.wav')).toBe('/Users/me/odd\\name.wav')
  })

  test('on this system the helpers are those of node:path', () => {
    expect(nodePath.join(tmp.path, 'a', '..', 'b')).toBe(nodePath.slashed(join(tmp.path, 'b')))
    expect(nodePath.dirname(nodePath.join(tmp.path, 'a', 'b.wav'))).toBe(
      nodePath.slashed(join(tmp.path, 'a')),
    )
    expect(nodePath.home()).not.toContain('\\')
  })
})

describe("Live's folders on Windows", () => {
  test('Live lies in ProgramData/Ableton, its content in the folder Resources', async () => {
    const ableton = join(tmp.path, 'ProgramData', 'Ableton')
    mkdirSync(join(ableton, 'Live 12 Suite', 'Resources', 'Core Library'), { recursive: true })
    mkdirSync(join(ableton, 'Live 11 Standard', 'Resources'), { recursive: true })
    // Not a Live: no folder with its content, or another name.
    mkdirSync(join(ableton, 'Live 10 Lite', 'Program'), { recursive: true })
    mkdirSync(join(ableton, 'Max 8', 'Resources'), { recursive: true })
    const installs = await findLiveInstalls(ableton, 'win32')
    expect(installs.map((install) => [install.version, install.app])).toEqual([
      ['12', join(ableton, 'Live 12 Suite')],
      ['11', join(ableton, 'Live 11 Standard')],
    ])
    expect(installs[0]).toMatchObject({
      appResources: join(ableton, 'Live 12 Suite', 'Resources'),
      coreLibrary: join(ableton, 'Live 12 Suite', 'Resources', 'Core Library'),
    })
    expect(await findLiveInstalls(join(tmp.path, 'none'), 'win32')).toEqual([])
  })

  test('Library.cfg lies one folder deeper, and names its folders as Windows writes paths', async () => {
    const base = join(tmp.path, 'AppData', 'Roaming', 'Ableton')
    const cfg = (library: string, pack: string) => `<?xml version="1.0" encoding="UTF-8"?>
<Ableton>
	<ContentLibrary>
		<UserLibrary>
			<LibraryProject>
				<ProjectName Value="User Library" />
				<ProjectPath Value="${library}" />
			</LibraryProject>
		</UserLibrary>
		<SliceInfoList>
			<LibrarySliceInfo Id="1" Path="${pack}" DisplayName="Chop and Swing" UniqueId="www.ableton.com/30" />
		</SliceInfoList>
	</ContentLibrary>
</Ableton>
`
    writeFile(
      join(base, 'Live 11.3.4', 'Preferences', 'Library.cfg'),
      cfg('C:\\Old\\Ableton', 'C:\\Old\\Factory Packs\\Chop and Swing'),
    )
    writeFile(
      join(base, 'Live 12.1.5', 'Preferences', 'Library.cfg'),
      cfg('C:\\Users\\someone\\Documents\\Ableton', 'D:\\Ableton\\Factory Packs\\Chop and Swing'),
    )
    const config = await readLibraryConfig(undefined, base, 'win32')
    expect(config).toEqual({
      preferences: join(base, 'Live 12.1.5', 'Preferences'),
      userLibrary: 'C:/Users/someone/Documents/Ableton/User Library',
      packs: [
        {
          path: 'D:/Ableton/Factory Packs/Chop and Swing',
          name: 'Chop and Swing',
          id: 'www.ableton.com/30',
        },
      ],
    })
    // On a Mac the file lies in the folder of its version itself: nothing is found here.
    expect(await readLibraryConfig(undefined, base, 'darwin')).toBeUndefined()
  })
})

test('Live runs when Windows lists its program, whatever its edition; its indexer is not Live', () => {
  const list = (...names: string[]) =>
    names.map((name, i) => `"${name}","${4000 + i}","Console","1","123,456 K"`).join('\r\n')
  expect(liveInTaskList(list('System Idle Process', 'explorer.exe', 'chrome.exe'))).toBe(false)
  expect(liveInTaskList(list('explorer.exe', 'Ableton Live 12 Suite.exe'))).toBe(true)
  expect(liveInTaskList(list('Ableton Live 11 Standard.exe'))).toBe(true)
  expect(liveInTaskList(list('ableton live 10 lite.exe'))).toBe(true)
  expect(liveInTaskList(list('Ableton Index.exe', 'Ableton Web Connector.exe'))).toBe(false)
  expect(liveInTaskList('')).toBe(false)
})

describe('names Windows does not make', () => {
  test('its reserved signs, a space or a dot at the end, the names of devices', () => {
    const refused = ['Perc: long.wav', 'what?.wav', 'a*b.wav', 'x|y.aif', '<in>.wav', 'q"uote.wav']
    expect(refused.map(refusedByWindows)).toEqual(refused.map(() => true))
    expect(
      ['Kick.wav ', 'Kick.', 'NUL', 'con.wav', 'COM1', 'lpt9.txt'].map(refusedByWindows),
    ).toEqual([true, true, true, true, true, true])
    const fine = [
      'Kick.wav',
      ' Perc.wav',
      'Console.wav',
      'com10.wav',
      'a.b.c.wav',
      'Größe #1 (x).wav',
    ]
    expect(fine.map(refusedByWindows)).toEqual(fine.map(() => false))
  })

  test('a place is refused for any of its names, and the drive is none of them', () => {
    const fs = new WindowsFs()
    expect(fs.refuses('C:/Music/Song Project/Samples/Imported/Kick.wav')).toBe(false)
    expect(fs.refuses('C:/Music/Song Project/Samples/Imported/Perc: long.wav')).toBe(true)
    expect(fs.refuses('C:/Music/Claps: Snares/Kick.wav')).toBe(true)
    expect(fs.refuses('C:/Music/Song Project /Kick.wav')).toBe(true)
  })
})
