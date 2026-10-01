/**
 * Built-in codemod: switch off the mastering devices on the master (Limiter, Glue Compressor,
 * Compressor, Multiband Dynamics, racks included), e.g. before exporting stems for a mastering
 * engineer. Devices whose on/off switch is automated or mapped are left alone.
 */
import { indexOfBytes, MASTERING_DEVICES } from '@livesaver/core'
import { type DeviceView, defineCodemod } from '../codemod.js'

const TAGS = [...MASTERING_DEVICES].map((d) => new TextEncoder().encode(`<${d} `))

export default defineCodemod({
  name: 'mastering-off',
  description:
    'Switch off Limiter, Glue Compressor, Compressor and Multiband Dynamics on the master',
  match: (xml) => TAGS.some((tag) => indexOfBytes(xml, tag, 0) >= 0),
  transform(set, ctx) {
    const master = set.master()
    if (!master) return
    const visit = (devices: readonly DeviceView[]) => {
      for (const d of devices) {
        if (MASTERING_DEVICES.has(d.type) && d.on && !d.setOn(false))
          ctx.note(`${d.name}: on/off is automated or mapped; left on`)
        if (d.isRack) for (const chain of d.chains()) visit(chain)
      }
    }
    visit(master.devices())
  },
})
