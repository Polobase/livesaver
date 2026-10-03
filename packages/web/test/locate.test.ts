/** Working out where a folder lies on disk from what the sets say about their projects. */
import { describe, expect, test } from 'bun:test'
import { locateFolder } from '../src/index.js'

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
