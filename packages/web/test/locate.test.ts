/** Working out where a folder lies on disk from what the sets say about their projects. */
import { describe, expect, test } from 'bun:test'
import {
  leadsTo,
  liveFolderPath,
  liveLandmark,
  locateFolder,
  placeByLeads,
  versionNumber,
} from '../src/index.js'

describe('locating a folder', () => {
  test('the folder of that name in the paths the sets stored', () => {
    expect(
      locateFolder('Projects', [
        { savedAt: '/Users/someone/Music/Projects/Song Project', inside: 'Song Project' },
        { savedAt: '/Users/someone/Music/Projects/Old/Loop Project', inside: 'Old/Loop Project' },
      ]),
    ).toEqual({ path: '/Users/someone/Music/Projects', votes: 2, of: 2 })
  })

  test('projects moved inside the folder since they were saved still say where it is', () => {
    expect(
      locateFolder('Projects', [
        {
          savedAt: '/Users/someone/Music/Projects/Remixes/A Project',
          inside: '1 In Progress/A Project',
        },
        {
          savedAt: '/Users/someone/Music/Projects/Old/B Project',
          inside: '4 Archive/Old/2014/B Project',
        },
      ])?.path,
    ).toBe('/Users/someone/Music/Projects')
  })

  test('the folder itself may be the project, and names compare like macOS', () => {
    expect(
      locateFolder('song project', [{ savedAt: '/Users/someone/Music/Song Project', inside: '' }]),
    ).toEqual({ path: '/Users/someone/Music/Song Project', votes: 1, of: 1 })
    expect(
      locateFolder('Cafe\u0301', [
        { savedAt: '/Volumes/Disk/Caf\u00e9/A Project', inside: 'A Project' },
      ])?.path,
    ).toBe('/Volumes/Disk/Caf\u00e9')
  })

  test('a name that occurs twice: the depth of the project picks the occurrence', () => {
    const savedAt = '/Users/someone/Projects/2020/Projects/A Project'
    expect(locateFolder('Projects', [{ savedAt, inside: 'A Project' }])?.path).toBe(
      '/Users/someone/Projects/2020/Projects',
    )
    expect(locateFolder('Projects', [{ savedAt, inside: '2020/Projects/A Project' }])?.path).toBe(
      '/Users/someone/Projects',
    )
  })

  test('unknown when the name is not in the paths, or the paths are from Windows', () => {
    expect(
      locateFolder('Music', [{ savedAt: '/Volumes/Disk/Projects/A Project', inside: 'A Project' }]),
    ).toBeUndefined()
    expect(
      locateFolder('Projects', [{ savedAt: 'E:\\Projects\\A Project', inside: 'A Project' }]),
    ).toBeUndefined()
    expect(locateFolder('Projects', [])).toBeUndefined()
  })

  test('the answer most sets agree on wins', () => {
    expect(
      locateFolder('Projects', [
        { savedAt: '/Volumes/Old Disk/Projects/A Project', inside: 'A Project' },
        { savedAt: '/Users/someone/Projects/B Project', inside: 'B Project' },
        { savedAt: '/Users/someone/Projects/C Project', inside: 'C Project' },
      ]),
    ).toEqual({ path: '/Users/someone/Projects', votes: 2, of: 3 })
  })
})

describe('a path that was typed for a folder of the Live app', () => {
  const APP = '/Applications/Ableton Live 12 Suite.app'
  const FORMS = [
    APP,
    `${APP}/Contents`,
    `${APP}/Contents/App-Resources`,
    `${APP}/Contents/App-Resources/Core Library`,
  ]

  test('may be any path into the app: the folder is placed at its own', () => {
    for (const typed of FORMS)
      expect(
        (['app', 'contents', 'resources', 'core'] as const).map((level) =>
          liveFolderPath(typed, level),
        ),
      ).toEqual(FORMS)
    // Wherever the app lies, and whatever it is called.
    expect(liveFolderPath('/Volumes/Apps/Live 11 Beta.app/Contents/MacOS', 'resources')).toBe(
      '/Volumes/Apps/Live 11 Beta.app/Contents/App-Resources',
    )
  })

  test('is taken as it is if it leads into no app', () => {
    expect(liveFolderPath('/Volumes/Backup/Core Library', 'core')).toBe(
      '/Volumes/Backup/Core Library',
    )
  })
})

describe("where Ableton's own folders lie, by the paths sets store", () => {
  const APP = '/Applications/Ableton Live 12 Suite.app'
  const core = (app = APP, version = 12_002_005) => ({
    path: `${app}/Contents/App-Resources/Core Library/Samples/Kick.aif`,
    version,
  })

  test('each folder of the Live app is the one of its name in the path', () => {
    const leads = (name: string, level: 'app' | 'contents' | 'resources' | 'core') =>
      leadsTo(name, [liveLandmark(level)], [core()]).map(({ path, inside }) => [path, inside])
    expect(leads('Ableton Live 12 Suite.app', 'app')).toEqual([
      [APP, 'Contents/App-Resources/Core Library/Samples/Kick.aif'],
    ])
    expect(leads('Contents', 'contents')).toEqual([
      [`${APP}/Contents`, 'App-Resources/Core Library/Samples/Kick.aif'],
    ])
    expect(leads('App-Resources', 'resources')).toEqual([
      [`${APP}/Contents/App-Resources`, 'Core Library/Samples/Kick.aif'],
    ])
    expect(leads('Core Library', 'core')).toEqual([
      [`${APP}/Contents/App-Resources/Core Library`, 'Samples/Kick.aif'],
    ])
    // What is not in the Core Library says nothing about where the Core Library lies.
    expect(
      leadsTo(
        'Core Library',
        [liveLandmark('core')],
        [{ path: `${APP}/Contents/App-Resources/Max/a.amxd`, version: 12_000_000 }],
      ),
    ).toEqual([])
  })

  test('a path only leads to the folder it names', () => {
    // Another app than the one that was given; a folder with a "Core Library" of the user's.
    expect(leadsTo('Ableton Live 11 Suite.app', [liveLandmark('app')], [core()])).toEqual([])
    expect(leadsTo('Mine', [liveLandmark('resources')], [core()])).toEqual([])
    // The landmark alone names no file to look for; a Windows path lies on no Mac.
    expect(
      leadsTo(
        'Contents',
        [liveLandmark('contents')],
        [
          { path: `${APP}/Contents/App-Resources`, version: 12_000_000 },
          { path: 'C:\\Live\\Contents\\App-Resources\\Core Library\\a.wav', version: 12_000_000 },
        ],
      ),
    ).toEqual([])
  })

  test('the User Library and the Factory Packs, or the folder that holds them', () => {
    const stored = [
      { path: '/Users/someone/Music/Ableton/User Library/Samples/a.wav', version: 12_000_000 },
      {
        path: '/Users/someone/Music/Ableton/Factory Packs/Pack/Samples/b.wav',
        version: 12_000_000,
      },
    ]
    const holds = [
      { names: ['User Library'], own: 0 },
      { names: ['Factory Packs'], own: 0 },
    ]
    expect(leadsTo('ableton', holds, stored).map(({ path, inside }) => [path, inside])).toEqual([
      ['/Users/someone/Music/Ableton', 'User Library/Samples/a.wav'],
      ['/Users/someone/Music/Ableton', 'Factory Packs/Pack/Samples/b.wav'],
    ])
    expect(leadsTo('User Library', [{ names: ['User Library'], own: 1 }], stored)).toEqual([
      {
        path: '/Users/someone/Music/Ableton/User Library',
        inside: 'Samples/a.wav',
        version: 12_000_000,
      },
    ])
    // A folder of another name does not lie where the sets say "Ableton" lies.
    expect(leadsTo('Live Stuff', holds, stored)).toEqual([])
  })

  test('the sets of the newest Live decide, and among them what most say', () => {
    const lead = (path: string, version: number) => ({ path, inside: 'a.wav', version })
    expect(
      placeByLeads([
        lead('/Applications/Ableton Live 10 Suite.app/Contents', 10_001_030),
        lead('/Applications/Ableton Live 10 Suite.app/Contents', 10_001_030),
        lead('/Applications/Ableton Live 10 Suite.app/Contents', 10_000_006),
        lead('/Applications/Ableton Live 12 Suite.app/Contents', 12_002_005),
      ]),
    ).toBe('/Applications/Ableton Live 12 Suite.app/Contents')
    expect(
      placeByLeads([
        lead('/Applications/Live.app/Contents', 12_000_001),
        lead('/Applications/Ableton Live 12 Suite.app/Contents', 12_002_005),
        lead('/Applications/Ableton Live 12 Suite.app/Contents', 12_001_000),
      ]),
    ).toBe('/Applications/Ableton Live 12 Suite.app/Contents')
    expect(placeByLeads([])).toBeUndefined()
  })

  test('a version sorts as a number', () => {
    expect([
      versionNumber('Ableton Live 12.2.5'),
      versionNumber('Ableton Live 9.7'),
      versionNumber('Ableton Live 10.1.30'),
      versionNumber(''),
    ]).toEqual([12_002_005, 9_007_000, 10_001_030, 0])
  })
})
