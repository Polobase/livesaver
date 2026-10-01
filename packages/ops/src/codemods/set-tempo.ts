/** Built-in codemod: set the master tempo (sets with tempo automation are left alone). */
import { defineCodemod } from '../codemod.js'

export default defineCodemod({
  name: 'set-tempo',
  description: 'Set the master tempo; sets whose tempo is automated are left alone',
  options: { bpm: 'the new tempo (10–999)' },
  transform(set, ctx) {
    const bpm = Number(ctx.options.bpm)
    if (!ctx.options.bpm || !Number.isFinite(bpm))
      throw new Error('--option bpm=<tempo> is required')
    if (set.tempo === bpm) return
    if (!set.setTempo(bpm)) ctx.note(`tempo is automated; left at ${set.tempo}`)
  },
})
