/** Codemods: typed views, the built-ins, safety checks, apply and undo. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EMPTY_REMAP } from '@livesaver/core'
import { createNodeHost } from '@livesaver/node'
import { makeProject, midiTrack, readSet, tempDir, writeSet } from '@livesaver/test-kit'
import {
  applyWriter,
  BUILTIN_CODEMODS,
  type Codemod,
  defineCodemod,
  Probe,
  runCodemod,
  undoRun,
} from '../src/index.js'

/** A Live 12 set whose tempo has an automation target and the envelope Live writes for it. */
function set12(
  options: { tempo?: number; automated?: boolean; masterDevices?: string } = {},
): string {
  const tempo = options.tempo ?? 120
  const extra = options.automated ? `<FloatEvent Id="2" Time="16" Value="${tempo + 8}" />` : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="12.0_12402" Creator="Ableton Live 12.4.2">
\t<LiveSet>
\t\t<Tracks>${midiTrack({ userName: 'Bass' })}</Tracks>
\t\t<MainTrack>
\t\t\t<AutomationEnvelopes>
\t\t\t\t<Envelopes>
\t\t\t\t\t<AutomationEnvelope Id="0">
\t\t\t\t\t\t<EnvelopeTarget><PointeeId Value="8" /></EnvelopeTarget>
\t\t\t\t\t\t<Automation><Events><FloatEvent Id="1" Time="-63072000" Value="${tempo}" />${extra}</Events></Automation>
\t\t\t\t\t</AutomationEnvelope>
\t\t\t\t</Envelopes>
\t\t\t</AutomationEnvelopes>
\t\t\t<DeviceChain>
\t\t\t\t<Mixer>
\t\t\t\t\t<Tempo>
\t\t\t\t\t\t<LomId Value="0" />
\t\t\t\t\t\t<Manual Value="${tempo}" />
\t\t\t\t\t\t<AutomationTarget Id="8"><LockEnvelope Value="0" /></AutomationTarget>
\t\t\t\t\t</Tempo>
\t\t\t\t</Mixer>
\t\t\t\t<DeviceChain><Devices>${options.masterDevices ?? ''}</Devices></DeviceChain>
\t\t\t</DeviceChain>
\t\t</MainTrack>
\t</LiveSet>
</Ableton>
`
}

const device = (tag: string, id: number, on = true) =>
  `<${tag} Id="${id}"><On><LomId Value="0" /><Manual Value="${on}" /><AutomationTarget Id="${900 + id}"><LockEnvelope Value="0" /></AutomationTarget></On></${tag}>`

const ENV = {
  userLibrary: '',
  factoryPacks: '',
  appResources: '',
  preferredRoots: [],
  vendorLibraries: [],
  remap: EMPTY_REMAP,
}

describe('codemods', () => {
  let tmp: { path: string; cleanup: () => void }
  let project: string
  beforeEach(() => {
    tmp = tempDir()
    project = makeProject(tmp.path, 'Song')
  })
  afterEach(() => tmp.cleanup())

  const host = (write = false) => createNodeHost({ write, trashDir: join(tmp.path, 'Trash') })
  const run = (codemod: Codemod, options: Record<string, string> = {}) =>
    runCodemod(host(), codemod, { targets: [project], options })
  const setTempo = BUILTIN_CODEMODS.get('set-tempo') as Codemod
  const masteringOff = BUILTIN_CODEMODS.get('mastering-off') as Codemod

  test('set-tempo changes the tempo and its start value, nothing else', async () => {
    const path = writeSet(join(project, 'Song.als'), set12())
    const h = host(true)
    const probe = new Probe(h.fs, h.hash)
    const r = await runCodemod(h, setTempo, {
      targets: [project],
      options: { bpm: '123.5' },
      probe,
      writer: applyWriter(h, { id: 'r', dir: join(tmp.path, 'run') }, probe),
    })
    expect(r.results[0]).toMatchObject({ changed: true, edits: 2, written: true, error: '' })
    expect(readSet(path)).toBe(set12().replaceAll('Value="120"', 'Value="123.5"'))
    expect(readdirSync(join(project, 'Backup'))).toHaveLength(1)
    // and undo puts it back
    const undo = await undoRun(h, { id: 'r', dir: join(tmp.path, 'run') }, ENV)
    expect(undo.restored).toEqual([path])
    expect(readSet(path)).toBe(set12())
  })

  test('an automated tempo is left alone, with a note', async () => {
    const path = writeSet(join(project, 'Song.als'), set12({ automated: true }))
    const r = await run(setTempo, { bpm: '100' })
    expect(r.results[0]).toMatchObject({
      changed: false,
      notes: ['tempo is automated; left at 120'],
    })
    expect(readSet(path)).toBe(set12({ automated: true }))
  })

  test('mastering-off switches off mastering devices on the master, racks included', async () => {
    const rack = `<AudioEffectGroupDevice Id="5"><Branches><AudioEffectBranch><DeviceChain><AudioToAudioDeviceChain><Devices>${device('GlueCompressor', 6)}${device('Reverb', 7)}</Devices></AudioToAudioDeviceChain></DeviceChain></AudioEffectBranch></Branches></AudioEffectGroupDevice>`
    const path = writeSet(
      join(project, 'Song.als'),
      set12({ masterDevices: device('Limiter', 1) + rack + device('Compressor2', 2, false) }),
    )
    const h = host(true)
    const probe = new Probe(h.fs, h.hash)
    const r = await runCodemod(h, masteringOff, {
      targets: [project],
      probe,
      writer: applyWriter(h, { id: 'r', dir: join(tmp.path, 'run') }, probe),
    })
    expect(r.results[0]).toMatchObject({ changed: true, edits: 2 })
    const text = readSet(path)
    expect(text).toContain('<Limiter Id="1"><On><LomId Value="0" /><Manual Value="false" />')
    expect(text).toContain('<GlueCompressor Id="6"><On><LomId Value="0" /><Manual Value="false" />')
    expect(text).toContain('<Reverb Id="7"><On><LomId Value="0" /><Manual Value="true" />') // no mastering device
  })

  test('a mapped on/off switch is left alone', async () => {
    const mapped = set12({ masterDevices: device('Limiter', 1) }).replace(
      '<Tracks>',
      '<Tracks><MidiTrack Id="9"><x><PointeeId Value="901" /></x></MidiTrack>',
    )
    writeSet(join(project, 'Song.als'), mapped)
    const r = await run(masteringOff)
    expect(r.results[0]).toMatchObject({
      changed: false,
      notes: ['Limiter: on/off is automated or mapped; left on'],
    })
  })

  test('your own codemod: views, notes, and a broken edit is never written', async () => {
    const path = writeSet(join(project, 'Song.als'), set12())
    const rename = defineCodemod({
      name: 'shout',
      transform(set, ctx) {
        for (const track of set.tracks()) {
          ctx.note(`${track.kind} ${track.name}`)
          track.rename(track.name.toUpperCase())
        }
      },
    })
    const r = await run(rename)
    expect(r.results[0]).toMatchObject({ changed: true, notes: ['midi Bass'] })
    const broken = defineCodemod({
      name: 'broken',
      transform(set) {
        set.patch.replace(set.liveSet, '<LiveSet>')
      },
    })
    const before = readFileSync(path)
    const h = host(true)
    const probe = new Probe(h.fs, h.hash)
    const b = await runCodemod(h, broken, {
      targets: [project],
      probe,
      writer: applyWriter(h, { id: 'b', dir: join(tmp.path, 'run-b') }, probe),
    })
    expect(b.results[0]?.error).not.toBe('')
    expect(b.results[0]?.written).toBe(false)
    expect(readFileSync(path)).toEqual(before)
  })
})
