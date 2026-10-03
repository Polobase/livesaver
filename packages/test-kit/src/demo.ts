/**
 * A small library with one of everything a scan can find: samples that are found again, files
 * outside their project, samples missing from a drive, a pack, an expansion and an old User
 * Library, a library file that was re-tagged (an uncertain match), a set that cannot be read, and
 * plug-ins. For tests of the screens, which need more than one of each row.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { liveCrc } from '@livesaver/core'
import { KICKSTART, liveSet, SERUM } from './builders.js'
import { makeProject, writeFile, writeSet } from './index.js'

export interface DemoLibrary {
  readonly root: string
  /** The folder with the project folders. */
  readonly projects: string
  /** A sample folder that has what several sets lost. */
  readonly samples: string
  /** A vendor's folder with an installed library (its name marks it as such). */
  readonly library: string
  /** A folder with a recording that a set uses from outside its project. */
  readonly elsewhere: string
}

const encoder = new TextEncoder()

/** A stand-in for audio: its name makes its content, so two samples never share a fingerprint. */
const audio = (name: string, bytes = 6000) =>
  encoder.encode(`RIFF ${name} `.repeat(Math.ceil(bytes / (name.length + 6))).slice(0, bytes))

interface Ref {
  /** Where the set says the file is. */
  readonly path: string
  /** The file as the set remembers it (none: the reference stores no fingerprint). */
  readonly content?: Uint8Array
  readonly relType?: number
  readonly relPath?: string
  readonly pack?: string
}

const attr = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')

function clip(ref: Ref): string {
  const size = ref.content?.length ?? 0
  const crc = ref.content ? liveCrc(ref.content) : 0
  return `<AudioClip Id="0" Time="0"><CurrentStart Value="0" /><CurrentEnd Value="4" /><Name Value="" />
<Disabled Value="false" /><SampleRef><FileRef><RelativePathType Value="${ref.relType ?? 0}" />
<RelativePath Value="${attr(ref.relPath ?? '')}" /><Path Value="${attr(ref.path)}" /><Type Value="2" />
<LivePackName Value="${attr(ref.pack ?? '')}" /><LivePackId Value="${ref.pack ? 'www.ableton.com/demo' : ''}" />
<OriginalFileSize Value="${size}" /><OriginalCrc Value="${crc}" /></FileRef>
<LastModDate Value="1719000000" /></SampleRef></AudioClip>`
}

const track = (refs: readonly Ref[]) =>
  `<AudioTrack Id="2"><Name><UserName Value="" /></Name><DeviceChain><MainSequencer><ClipSlotList />
<Sample><ArrangerAutomation><Events>${refs.map(clip).join('')}</Events></ArrangerAutomation></Sample>
</MainSequencer></DeviceChain></AudioTrack>`

/** Where the samples were when the sets were saved: a drive that is no longer there. */
const OLD_DRIVE = '/Volumes/Old Drive'

export function demoLibrary(root: string, sketches = 8): DemoLibrary {
  const projects = join(root, 'Projects')
  const samples = join(root, 'Samples')
  const library = join(root, 'Native Instruments')
  const elsewhere = join(root, 'Recordings')

  // What the sample folder has: found again by size and checksum, wherever it was before.
  const kept = (name: string, folder: string): Ref => {
    const content = audio(name)
    writeFile(join(samples, folder, name), content)
    return { path: `${OLD_DRIVE}/Samples/${folder}/${name}`, content }
  }
  const kicks = [1, 2, 3, 4].map((n) => kept(`Kick 0${n}.wav`, 'Drums/Kicks'))
  const snares = [1, 2].map((n) => kept(`Snare 0${n}.wav`, 'Drums/Snares'))
  const loop = kept('Loop 120 A.wav', 'Loops')

  /** A sample of the project itself, in its place. */
  const own = (project: string, name: string): Ref => {
    const content = audio(`${project} ${name}`)
    const path = writeFile(join(project, 'Samples', 'Recorded', name), content)
    return { path, content, relType: 3, relPath: `Samples/Recorded/${name}` }
  }
  /** A sample nobody has any more. */
  const gone = (path: string, pack = ''): Ref => ({
    path,
    content: audio(path),
    ...(pack ? { pack, relType: 5, relPath: path } : {}),
  })
  const set = (project: string, name: string, refs: readonly Ref[], plugins = '') =>
    writeSet(join(project, `${name}.als`), liveSet(track(refs), { plugins }))

  const night = makeProject(projects, 'Night Drive')
  const bass = own(night, 'Bass.wav')
  set(night, 'Night Drive', [kicks[0] as Ref, snares[0] as Ref, bass], SERUM)
  set(night, 'Night Drive v2', [kicks[0] as Ref, snares[0] as Ref, bass, loop], SERUM + KICKSTART)

  const morning = makeProject(projects, 'Morning Light')
  set(morning, 'Morning Light', [
    kicks[1] as Ref,
    gone(`${OLD_DRIVE}/Sample Packs/Vintage Breaks/Break 07.wav`),
    gone(`${OLD_DRIVE}/Sample Packs/Vintage Breaks/Break 11.wav`),
    gone('Samples/Hits/Clap Tight.wav', 'Drum Essentials'),
  ])

  // The set was made with an older version of the library: same sound, other tags.
  const shaker = 'Drum Library/Samples/Drums/Shaker/Shaker 1.wav'
  writeFile(join(library, shaker), encoder.encode(`RIFF${'shaker '.repeat(400)}tags 1.1!`))
  set(makeProject(projects, 'Shaker Song'), 'Shaker Song', [
    {
      path: `${OLD_DRIVE}/Maschine Library/${shaker}`,
      content: encoder.encode(`RIFF${'shaker '.repeat(400)}tags 1.0`),
    },
    snares[1] as Ref,
  ])

  // A recording that exists, but outside the project: a fix collects it.
  const take = writeFile(join(elsewhere, 'Vocal take 3.wav'), audio('Vocal take 3'))
  const vocals = makeProject(projects, 'Vocals')
  set(vocals, 'Vocals', [{ path: take, content: audio('Vocal take 3') }, own(vocals, 'Guide.wav')])

  const finished = makeProject(projects, 'Finished')
  set(finished, 'Finished', [own(finished, 'Piano.wav'), own(finished, 'Strings.wav')], KICKSTART)

  set(makeProject(projects, 'Lost Tapes'), 'Lost Tapes', [
    ...[1, 2, 3].map((n) =>
      gone(`E:\\Maschine Library\\Vintage Heat Library\\Samples\\Drums\\Kick\\Kick Heat ${n}.wav`),
    ),
    gone('/Users/earlier/Music/Ableton/User Library/Samples/Old/Riser.wav'),
  ])

  // Not a set at all: a file that was cut off.
  writeFile(join(makeProject(projects, 'Broken File'), 'Broken.als'), 'not a Live Set')

  // More of the ordinary, so that tables have rows to sort and search.
  for (let i = 1; i <= sketches; i++) {
    const name = `Sketch ${String(i).padStart(2, '0')}`
    const sketch = makeProject(projects, name)
    const refs = [own(sketch, 'Idea.wav')]
    if (i % 2 === 0) refs.push(kicks[i % kicks.length] as Ref)
    if (i % 3 === 0) refs.push(loop)
    set(sketch, name, refs, i % 4 === 0 ? SERUM : '')
  }
  mkdirSync(elsewhere, { recursive: true })
  return { root, projects, samples, library, elsewhere }
}
