# Codemods

A codemod is a small program that changes Live Sets. livesaver runs it over folders of sets, shows
what would change, and with `--apply` writes the changes the same way every livesaver command
does: the result must be well-formed XML, Live's backup scheme is followed
(`Backup/<set> [date time].als`), the run is journaled, and `livesaver undo <run>` puts every set
back.

```sh
livesaver run --list                                        # built-in codemods
livesaver run set-tempo ~/Music/Projects --option bpm=124   # dry run: what would change
livesaver run set-tempo ~/Music/Projects --option bpm=124 --apply
livesaver run ./my-codemod.ts ~/Music/Projects               # your own
```

## Writing one
```ts
import type { Codemod } from 'livesaver'

export default {
  name: 'rename-bass',
  description: 'Call every track named "bass" "Bass"',
  transform(set, ctx) {
    for (const track of set.tracks()) {
      if (track.name.toLowerCase() === 'bass' && track.name !== 'Bass') {
        ctx.note(`${track.name} → Bass`)
        track.rename('Bass')
      }
    }
  },
} satisfies Codemod
```
- The import is type-only, so the file needs nothing at run time. Bun runs it as it is, and so does
  Node ≥ 22.18, as long as the file uses only TypeScript that type stripping removes (no enums,
  namespaces or parameter properties).
- `transform` only *describes* edits through `set` (or `set.patch`). Nothing is written while it
  runs, and a set it does not touch is not written at all.
- `ctx.options` holds `--option key=value` pairs; `ctx.note(…)` adds a line to the report.
- Throwing an error skips that set and reports the error.

## Views
| | |
|---|---|
| `set.tracks()` | audio, MIDI, group and return tracks in order (`TrackView`) |
| `set.master()` | the master (`MainTrack`, `MasterTrack` before Live 12) |
| `set.tempo`, `set.tempoAutomated`, `set.setTempo(bpm)` | the master tempo; the start value of Live's tempo envelope is changed too, an automated tempo never |
| `set.locators()` | `{ el, time, name }` in time order |
| `set.rootAttr('Creator')` | root attributes (`Creator`, `MinorVersion`) |
| `set.setValue(el, 'Name/UserName', 'x')` | set the `Value` of a child element |
| `set.pointees()` | ids that automation, modulation or mappings point to |
| `track.kind`, `track.name`, `track.rename(name)`, `track.devices()` | a track (`DeviceView`s of its chain) |
| `device.type`, `device.name`, `device.plugin`, `device.isRack`, `device.chains()` | a device; `plugin` is `{ format, ident, name }` for plug-ins |
| `device.on`, `device.onLinked`, `device.setOn(on)` | the on/off switch (automated or mapped switches are left alone) |

Anything else goes through the element index and the patcher:
- `set.index`: `children`, `child`, `find(el, 'A/B')`, `findAll`, `descendants`, `all(name)`, `attr`, `value`
- `set.patch`: `setAttr(el, name, value)`, `replace(el, xml)`, `replaceInner(el, text)`,
  `insertBefore(el, xml)`, `insertAfter(el, xml)`, `remove(el)`

Edits are spliced into the original bytes; everything you do not touch stays byte-identical.

## Checks before anything is written
- The patched document is scanned again, strictly; a malformed edit is an error for that set, and
  nothing is written.
- If the number of sample/device references or plug-ins changed, the report says so.
- The set must not have changed since it was read (Live saving it meanwhile): otherwise it is not
  written.
- `--apply` refuses to run while Live is open (`--force` overrides).

## Built-ins
- `set-tempo --option bpm=<n>`: set the master tempo (sets with tempo automation are left alone).
- `mastering-off`: switch off Limiter, Glue Compressor, Compressor and Multiband Dynamics on the
  master, racks included, e.g. before exporting stems for a mastering engineer.

More examples are in [`examples/codemods`](../examples/codemods).
