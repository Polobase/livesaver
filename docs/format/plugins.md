# Plug-ins in Live Sets

## Storage
- **VST2:** `PluginDevice/PluginDesc/VstPluginInfo`
  - fields: `Path`, `PlugName` (often the file name, e.g. `Serum_x64`), `UniqueId` (int32 of the 4CC), `Inputs`, `Outputs`, `NumberOfParameters`, `NumberOfPrograms`, `Flags`, `Version`, `VstVersion`, `IsShellClient`, `Category`
  - `Preset/VstPreset`:
    - `Type`: 1178747752 = `FBCh` (opaque chunk) or 1182286443 = `FxBk` (parameter bank)
    - `ProgramCount`, `ParameterCount`, `ProgramNumber`
    - `Buffer` (hex), `Name`, `PluginVersion`, `UniqueId`, `ByteOrder`
- **VST3:** `PluginDevice/PluginDesc/Vst3PluginInfo`
  - fields: `WinPosX/Y`, `NumAudioInputs/Outputs`, `IsPlaceholderDevice`, `Preset/Vst3Preset`, `Name`, `Uid/Fields.0-3`, `DeviceType` (1 instrument, 2 effect)
  - `Vst3Preset` holds `ProcessorState` (hex) and `ControllerState` (hex, often empty)
  - no path
- **AU:** `AuPluginDevice/PluginDesc/AuPluginInfo` with `ComponentType/SubType/Manufacturer` (4CCs as ints), `Name`, `Manufacturer`.
- **Reading them fast:** both device elements end in `PluginDevice`, never nest, and hold the
  plug-in's state as text. One byte search for that name finds them all, and only their own
  elements need scanning (`pluginUses`): a Set is mostly clips and automation.
- Live 12.4.5 and earlier never replace one format with another. A VST2 device shows as missing even when its VST3 version is installed.

## VST3 class id from a VST2 id
Steinberg FAQ, "Compatibility with VST 2.x":
- **16 bytes:** `'V' 'S' 'T'` (processor) or `'V' 'S' 'E'` (controller), then the VST2 id as 4 bytes big-endian, then the first 9 characters of the **lowercased** effect name, zero-padded.
- **Worked example, Serum:** `UniqueId 1483109208 = 'XfsX'` → `56535458 66735873 6572756D 00000000`.
- Because `PlugName` is often a file name, match installed VST3s by the first 7 bytes (`565354` + VST2 id).
  - With several matches, a class id whose name bytes match too is preferred; otherwise the first
    in sorted order.
- **Live stores the UID** as `Fields.0-3` = 4 **signed big-endian int32**.
  - FabFilter Pro-Q 4: `-313016974, 1549813374, -1504849164, 7703407` = `ed57bd72-5c60-467e-a64d-d2f400758b6f`
  - Massive: `[1448301646, 1766678893, 1634956137, 1986330624]`
- **Framework default ids** (useful when `moduleinfo.json` is missing):
  - JUCE: component `ABCDEF01 9182FAEB <mfr 4CC> <plugin 4CC>`, controller `ABCDEF01 1234ABCD …`; the 4CCs equal the AU manufacturer and subtype
  - iPlug2: `F2AEE70D 00DE4F4E <mfr> <unique id>`
- **AU link:** the AU subtype often equals the VST2 id (Massive: `aumu NiMa -NI-`).

## Finding the same plug-in in another format (`plugins audit`)
Strongest link first: the VST3 bundle **declares** the old class id in `moduleinfo.json`
(`Compatibility`); the **Steinberg** id (`565354`/`565345` + VST2 id); **JUCE** or **iPlug2** default
ids built from the AU codes; the **AU code** (subtype = VST2 id); the name alone is only a hint.

## Declared compatibility
- `moduleinfo.json` (JSON5, so trailing commas must be accepted) has `"Compatibility": [{ "New": "<cid>", "Old": ["<cid>", …] }]`.
  - Check both `Contents/moduleinfo.json` and `Contents/Resources/moduleinfo.json`.
  - Only 2 of your 69 VST3 bundles have one (Serum2, RoughRider3).
- `IPluginCompatibility`: a factory class in category `"Plugin Compatibility Class"`. It is only reachable by loading the binary.
- `.vstpreset`: `'VST3'` + an int32 version + 32 ASCII hex characters of the class id at offset 8.

## State migration VST2 → VST3
- **Steinberg's rule:** the host passes the complete FXB/FXP stream to `setState`. Its layout is `['VstW' | size 8 | version 1 | bypass] 'CcnK' | byteSize | 'FBCh'|'FxBk' | version | fxID | fxVersion | numPrograms | …`, all big-endian.
- **JUCE with `CAN_REPLACE_VST2`:** tries the VST2 state first, then the raw bytes.
- **Verified per plug-in** (only these count as safe):

| Plug-in | Strategy | Source |
|---|---|---|
| Massive | verbatim chunk; VST3 parameter ids = VST2 indices (automation kept) | Live-saved fixture |
| Serum | verbatim chunk; parameter list reset | Live-saved fixture, abletoolz |
| Omnisphere | `struct.pack("<IIIIQ", 999999999, 0, 1, 0, len) + chunk + bytes(4)`, hex uppercase, 80 chars per line; UID `84e8de5f9255222296fae4133c935a18` | Live-saved fixture |
| Kilohearts | 8-byte LE header `{1, len}` | abletoolz (facts) |
| FabFilter | reframing/trailer | abletoolz (facts) |

Everything else would need a small native helper that loads the plug-in: `setState(FXB)`, then `getState`. That is in the backlog.

## Conversion rules (`livesaver plugins upgrade`)
- **Blockers:**
  - `old_format`: MinorVersion < `10.0_377`
  - `rack`: inside `InstrumentGroupDevice|AudioEffectGroupDevice|DrumGroupDevice|MidiEffectGroupDevice`
  - `no_vst3`
  - `chunk`: not `FBCh` or empty `Buffer`
  - `links`: automation or modulation target referenced by a `PointeeId`, or `KeyMidi`, when parameter ids aren't verified
  - `default_links`: a linked parameter with `ParameterId -1`
  - `vst3_type`: category not instr or audiofx
- **All or nothing** per plug-in per set.
- **Post-checks:** well-formed, PluginDevice count unchanged, `Vst3PluginInfo` count up by exactly the converted count, sample-ref count unchanged.
- **Kept children and parameter resets:** see `packages/plugins/src/convert.ts`; checked against the Live-saved fixture `fixtures/projects/VST2toVST3 Project`.
