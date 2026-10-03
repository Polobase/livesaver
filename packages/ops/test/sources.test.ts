/** Where missing samples came from: packs, expansions, projects, folders. */
import { describe, expect, test } from 'bun:test'
import { EMPTY_REMAP } from '@livesaver/core'
import {
  Environment,
  FOUND_NAMES,
  foundLocation,
  foundSources,
  KIND_NAMES,
  libraryGroups,
  libraryOf,
  type MissingGroup,
  type Probe,
  type SetResult,
  type Status,
} from '../src/index.js'

function group(
  path: string,
  o: { source?: string; pack?: string; status?: Status; sets?: string[]; projects?: string[] } = {},
): MissingGroup {
  return {
    path,
    source: o.source ?? 'other location',
    pack: o.pack ?? '',
    status: o.status ?? 'not-found',
    name: path.split('\\').at(-1) as string,
    kind: 'sample',
    size: 0,
    sets: new Set(o.sets ?? ['a.als']),
    projects: new Set(o.projects ?? ['A']),
    choice: { status: o.status ?? 'not-found', path: '', method: 'none', candidates: [] } as never,
  }
}

describe('library of a missing sample (LibraryOfTest)', () => {
  test('groups by pack, expansion, project and folder', () => {
    const cases: [MissingGroup, [string, string]][] = [
      [
        group(
          'C:\\Users\\someone\\Documents\\Ableton\\Factory Packs\\Skitter and Step\\Samples\\x.wav',
          { source: 'Live Pack: Skitter and Step', pack: 'Skitter and Step' },
        ),
        ['Ableton pack', 'Skitter and Step'],
      ],
      [
        group('E:\\Librarys\\Maschine Library\\Dark Pressure Library\\Samples\\Drums\\Kick 1.wav'),
        ['NI expansion', 'Dark Pressure Library'],
      ],
      [
        group('/Librarys/Maschine Library/Gray Forge Library/Samples/Snare 2.wav'),
        ['NI expansion', 'Grey Forge Library'],
      ],
      [
        group('E:\\Ableton\\User Library\\User Library\\Samples\\Imported\\Kick 1.wav'),
        ['User Library (old)', 'Samples/Imported'],
      ],
      [
        group('F:\\Ableton\\someone\\Old\\Demo Project\\Samples\\Imported\\29 DAH Kick E.wav'),
        ['Old project', 'Demo Project'],
      ],
      [
        group('E:\\Samples\\Other\\Sample Tools by Cr2 - Deep Analogue House\\Audio\\Loop 1.wav'),
        ['Folder', 'E:\\Samples\\Other\\Sample Tools by Cr2 - Deep Analogue House'],
      ],
      [
        group('/Users/someone/Downloads/vocal-pack/vocal.wav'),
        ['Folder', '/Users/someone/Downloads/vocal-pack'],
      ],
      [group('Samples/Imported/01 DAH Clap.wav'), ["Project's own samples", 'Samples/Imported']],
      [group('/Kick 2.wav'), ['Folder', '(file name only)']],
    ]
    for (const [g, expected] of cases) {
      const [kind, name] = libraryOf(g)
      expect([g.path, KIND_NAMES[kind], name]).toEqual([g.path, ...expected])
    }
  })

  test('aggregation', () => {
    const libs = libraryGroups([
      group('E:\\Librarys\\Maschine Library\\Dark Pressure Library\\Samples\\a.wav', {
        projects: ['A'],
      }),
      group('F:\\Librarys\\Maschine Library\\Dark Pressure Library\\Samples\\b.wav', {
        projects: ['B'],
        sets: ['b.als'],
        status: 'mismatch',
      }),
      group('E:\\Samples\\Other\\Pack\\c.wav'),
    ])
    const top = libs[0]
    expect([top?.name, top?.samples, top?.notFound]).toEqual(['Dark Pressure Library', 2, 1])
    expect([top?.sets.size, top?.projects.size]).toEqual([2, 2])
  })
})

describe('where found samples lie', () => {
  const env = new Environment(
    {
      userLibrary: '/Users/someone/Music/Ableton/User Library',
      factoryPacks: '/Users/someone/Music/Ableton/Factory Packs',
      appResources: '/Applications/Live.app/Contents/App-Resources',
      preferredRoots: ['/Users/someone/Music/Samples'],
      vendorLibraries: ['/Users/Shared'],
      remap: EMPTY_REMAP,
    },
    undefined as unknown as Probe, // only needed to read pack properties
  )
  const roots = ['/Users/someone/Music', '/Users/Shared']
  const project = '/Users/someone/Music/Projects/Song Project'

  test('own project, pack, library, other project, folder', () => {
    const cases: [string, string][] = [
      [`${project}/Samples/Imported/a.wav`, 'Own project: Samples/Imported'],
      [`${project}/a.wav`, 'Own project: .'],
      [
        '/Applications/Live.app/Contents/App-Resources/Core Library/Samples/a.wav',
        'Ableton Core Library: Core Library',
      ],
      [
        '/Users/someone/Music/Ableton/Factory Packs/Drum Essentials/Samples/a.wav',
        'Ableton pack: Drum Essentials',
      ],
      [
        '/Users/someone/Music/Ableton/User Library/Samples/Imported/a.wav',
        'User Library: Samples/Imported',
      ],
      ['/Users/Shared/Drum Library/Samples/Drums/Kick/a.wav', 'Library: Drum Library'],
      [
        '/Users/someone/Music/Projects/Old/Demo Project/Samples/Imported/a.wav',
        'Other project: Demo Project',
      ],
      ['/Users/someone/Music/Samples/Vocal Pack/Dry/a.wav', 'Folder: Samples/Vocal Pack'],
      ['/Users/someone/Music/Recordings/2020/a.wav', 'Folder: Music/Recordings'],
      ['/Volumes/Old Disk/Loops/a.wav', 'Folder: /Volumes/Old Disk/Loops'],
    ]
    for (const [path, expected] of cases) {
      const [kind, name] = foundLocation(path, project, env, roots)
      expect([path, `${FOUND_NAMES[kind]}: ${name}`]).toEqual([path, expected])
    }
  })

  test('repaired samples are counted per place: distinct files and projects', () => {
    const change = (action: string, source: string, newPath = 'Samples/Imported/x.wav') =>
      ({ action, source, newPath }) as SetResult['changes'][number]
    const set = (projectRoot: string, changes: SetResult['changes']) =>
      ({ projectRoot, changes }) as SetResult
    const kick = '/Users/Shared/Drum Library/Samples/Kick/Kick 1.wav'
    const sources = foundSources(
      [
        set(project, [
          change('repaired', kick),
          change('repaired', '/Users/Shared/Drum Library/Samples/Kick/Kick 2.wav'),
          change('repaired', '', 'Samples/Old/y.wav'), // found inside the project: not copied
          change('collected', '/Users/someone/Music/Samples/Vocal Pack/z.wav'), // was never missing
        ]),
        set('/Users/someone/Music/Projects/B Project', [change('repaired', kick)]),
      ],
      env,
      roots,
    )
    expect(
      sources.map((f) => [FOUND_NAMES[f.kind], f.name, f.files.size, f.projects.size]),
    ).toEqual([
      ['Library', 'Drum Library', 2, 2],
      ['Own project', 'Samples/Old', 1, 1],
    ])
  })
})
