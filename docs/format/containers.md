# Containers and id spaces

## Documents
- `.als` (Live Set), `.adg` (rack preset), `.adv` (device preset), `.alc` (clip): **gzip-compressed UTF-8 XML**.
  - Recognized by the gzip magic `1f 8b`. Plain XML (starting with `<?xml`) is accepted too.
  - Root element `<Ableton …>` (see [versions.md](versions.md)).
- `.agr` (groove): often gzip XML, but many factory grooves use a **legacy binary** format ("103 of 219").
- Sets from before Live 8.2 are binary, magic `AB 1E`. livesaver reports these as unsupported.
- Live writes tab indentation, one element per line, and self-closing elements in the form `<Name Value="…" />`.
  - When a value contains `"`, Live uses single quotes: `Value='say "hi"'`.
  - Parsers must accept both quote styles.
- livesaver writes changed values as `Value="…"` with `&quot;`; Live 12 reads that back.
- Compression ratio on a real 7.4 MB set: 45.2 MB XML (6.1×), 611k elements.

## `.amxd` (Max for Live device)
Source: Ableton `maxdevtools` (`amxd_textconv.py`, `freezing_utils.py`).

The file is a sequence of chunks, each a 4-byte ASCII tag, a **u32 LE** length, then the payload:
- `ampf`: a 4-byte device type
  - `aaaa` audio effect
  - `mmmm` MIDI effect
  - `iiii` instrument
  - `nagg` MIDI generator
  - `natt` MIDI transformation
- `meta`: ignored.
- `ciph`: the device is encrypted.
- `ptch`: the patcher, as JSON that may be NUL-terminated.

A **frozen** `ptch` starts with `mx@c`:
- bytes 8–16 hold a **u64 BE** offset to the footer
- the footer is `dlst` + a u32 BE size, followed by `dire` entries
- each entry holds `type`, `fnam`, `sz32`, `of32`, `vers`, `flag` and `mdat` (HFS+ seconds; everything big-endian)
- the first entry is the device itself

Only the type code (`head[:4] == "ampf"`, type = `head[8:12]`) is needed to pick the collect folder:

| Type | Folder |
|---|---|
| `aaaa` | `Presets/Audio Effects/Max Audio Effect/Imported` |
| `iiii` | `Presets/Instruments/Max Instrument/Imported` |
| `mmmm` | `Presets/MIDI Effects/Max MIDI Effect/Imported` |
| other, e.g. `natt` | `Presets/Imported` |

## `.asd` (analysis, Live 12)
- Magic `06 49`, then a u64 LE entry count, a u32 position table and 17 constant bytes.
- Then documents, each starting with `AB 1E 56 78` and version 5: `SampleData`, `AufTaktData`.
- Live regenerates `.asd` files written by other tools. livesaver only *copies* them next to their sample.
- Source for the layout: abletoolz `asd/FORMAT.md` (GPL, used for facts only).

## `.alp` (pack)
- Starts with `pl-a` plus the offset of a table of contents stored at the end of the file.
- Usually gzipped as a whole; samples are stored as `name.wav.flac`. Not planned.

## Id spaces inside a Set
1. **Chain-local `Id` attributes** on list items: unique within their parent list. They are sparse, because Live never reuses numbers.
2. **Pointee ids.** One counter, `LiveSet/NextPointeeId`, is shared by `Pointee`, every `*AutomationTarget` / `*ModulationTarget`, and controller targets.
   - They must be unique and `< NextPointeeId`; duplicates make Live report "Pointee IDs are not unique" / "corrupt".
   - Live 9 has no `NextPointeeId`.
3. **`RelativePathElement` ids (Live 10 old-format FileRefs only).**
   - New ones are allocated as max + 1 over *all* `RelativePathElement Id`s in the document.
   - They are separate from the pointee ids; keep them apart (livesaver `RelPathIds`).
4. **MIDI notes (Live 11+):** `MidiNoteEvent@NoteId` is unique per clip, plus `Notes/NoteIdGenerator/NextId`.

When grafting devices between Sets:
- give the subtree fresh pointee ids and bump `NextPointeeId`
- strip `KeyMidi` bindings (they crash Live 12 on load)
