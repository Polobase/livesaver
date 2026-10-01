/**
 * Example codemod: give tracks that still carry Live's automatic name ("1-MIDI", "3-Audio") the
 * name of their first plug-in or instrument, e.g. "Serum". Run it with
 *
 *   livesaver run examples/codemods/name-tracks.ts ~/Music/Projects          # what would change
 *   livesaver run examples/codemods/name-tracks.ts ~/Music/Projects --apply  # do it (undo-able)
 *
 * The import is type-only and `satisfies` is erased too, so the file needs nothing at run time:
 * Bun and Node ≥ 22.18 (type stripping) run it as it is, wherever it lives.
 */
import type { Codemod } from 'livesaver'

const INSTRUMENT =
  /Instrument|Simpler|Sampler|Operator|Drift|Analog|Collision|LoungeLizard|StringStudio/

export default {
  name: 'name-tracks',
  description: 'Name automatically named tracks after their first plug-in or instrument',
  transform(set, ctx) {
    for (const track of set.tracks()) {
      if (track.kind !== 'midi' && track.kind !== 'audio') continue
      if (!/^\d+-/.test(track.name)) continue // already named by you
      const device = track.devices().find((d) => d.plugin || INSTRUMENT.test(d.type))
      if (!device) continue
      ctx.note(`${track.name} → ${device.name}`)
      track.rename(device.name)
    }
  },
} satisfies Codemod
