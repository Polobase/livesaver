/** Where missing samples came from: packs, expansions, projects, folders. */
import { describe, expect, test } from 'bun:test'
import {
  KIND_NAMES,
  libraryGroups,
  libraryOf,
  type MissingGroup,
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
