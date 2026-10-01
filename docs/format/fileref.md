# FileRef

A `<FileRef>` locates one file. It appears in many containers, but only some are real dependencies.

| Container | Meaning | livesaver |
|---|---|---|
| `SampleRef` (optionally `Id="N"`) | a sample Live loads | parsed and patched |
| `MxPatchRef` (Live 12), `MxDPatchRef` (≤ 11) | a Max for Live device (`.amxd`) | parsed and patched |
| `OriginalFileRef`, `FilePresetRef`, `AbletonDefaultPresetRef` | where embedded content came from | reported only; Live doesn't need them to load |

livesaver recognises the pattern `<(SampleRef|MxPatchRef|MxDPatchRef)( Id="\d+")?>` with whitespace, then `<FileRef>…</FileRef>`, then optionally whitespace and `<LastModDate Value="…" />`.

## New format (Live 11+)
Children in order: `RelativePathType`, `RelativePath` (string, `/`-separated), `Path` (absolute, forward slashes even on Windows), `Type`, `LivePackName`, `LivePackId`, `OriginalFileSize`, `OriginalCrc`, and from 12.4 also `SourceHint`.

```xml
<SampleRef>
  <FileRef>
    <RelativePathType Value="3" />
    <RelativePath Value="Samples/Imported/1.wav" />
    <Path Value="/Users/me/Music/Song Project/Samples/Imported/1.wav" />
    <Type Value="2" />
    <LivePackName Value="" />
    <LivePackId Value="" />
    <OriginalFileSize Value="2000324" />
    <OriginalCrc Value="17226" />
    <SourceHint Value="" />
  </FileRef>
  <LastModDate Value="1790703000" />
  <SourceContext />…<DefaultSampleRate Value="44100" />
</SampleRef>
```
Siblings of the FileRef: `LastModDate` (Unix seconds), `SourceContext/…/OriginalFileRef` + `BrowserContentPath`, `LocalFiltersJson` (12), `SampleUsageHint`, `DefaultDuration`, `DefaultSampleRate`.

## Old format (Live 8.2–10)
```xml
<FileRef>
  <HasRelativePath Value="true" />
  <RelativePathType Value="1" />
  <RelativePath>
    <RelativePathElement Id="239" Dir="" />            <!-- Dir="" means ".." ; Id only in Live 10 -->
    <RelativePathElement Id="240" Dir="Other Project" />
  </RelativePath>
  <Name Value="1.wav" />
  <Type Value="1" />
  <Data>…hex…</Data>                                   <!-- absolute path, see below -->
  <RefersToFolder Value="false" />
  <SearchHint>
    <PathHint><RelativePathElement Id="25" Dir="Users" />…</PathHint>
    <FileSize Value="2000324" />
    <Crc Value="17226" />
    <MaxCrcSize Value="16384" />                        <!-- 0 when HasExtendedInfo is false -->
    <HasExtendedInfo Value="true" />
  </SearchHint>
  <LivePackName Value="" />
  <LivePackId Value="" />
</FileRef>
```
- The format is chosen by `"<HasRelativePath "` appearing in the body.
- Live 9 has no `Id` attributes. `HasRelativePath="false"` comes with `<RelativePath />` and `<Data />`.
- The hint path is `"/" + PathHint dirs + "/" + Name`, used only when both are present.

### `Data`
Hex text (whitespace ignored) decoded to bytes:
- **Windows:** `raw[1] == 0` and `raw[2:4] == ":\0"` → UTF-16LE path up to the first NUL.
- **macOS classic alias, version 2:**
  - `len ≥ 150` and `u16be(raw[6:8]) == 2`
  - tagged records start at offset 150: `i16be` tag, `u16be` length, data, padded to an even length; tag `-1` ends the list
  - tag `0x12` is the POSIX path relative to the volume; tag `0x13` is the mount point, giving `mount.rstrip('/') + '/' + path.lstrip('/')`
  - otherwise tag `2` is an HFS path `Vol:dir:file` in Mac Roman, giving `'/' + parts[1:].join('/')`

## RelativePathType
Source: Mattijs Kneppers (maxdevtools author) on the Cycling '74 forum, confirmed against real sets.

| Value | Meaning | Resolved against |
|---:|---|---|
| -1 | invalid | — |
| 0 | unknown | only `Path` |
| 1 | relative to the document (the folder of the `.als`; may climb with `..`) | set folder, then project root |
| 2 | old library | only through `filerefmap.db` (type 2 → 5) |
| 3 | relative to the project root (nearest folder upward with `Ableton Project Info`) | project root, then set folder |
| 4 | reserved | — |
| 5 | factory pack / Core Library (`LivePackId`, Core Library = `www.ableton.com/0`) | Core Library, or `Factory Packs/<LivePackName>` |
| 6 | User Library | User Library |
| 7 | built-in content (`<Live.app>/Contents/App-Resources/Builtin`) | Builtin |

Counts on your library (917 sets): 3 = 296,399; 1 = 289,371; 5 = 262,209; 0 = 56,934; 6 = 17,519; 2 = 398; 7 = 385.

`FileRef/Type` is 1 in every Windows-saved ref and 2 in every macOS-saved ref seen so far. That suggests it records the saving OS, but this is unverified.

## Patching
- **Rewrite type:** a target inside the project gets type 3, relative to the root; inside a pack, type 5 with the pack's name and id; otherwise type 1, relative to the set folder.
- **Path components:** written in NFC.
- **New format:** set `RelativePathType`, `RelativePath`, `Path`, plus the pack fields for type 5. `OriginalFileSize` and `OriginalCrc` stay: they describe the original file, as Live does.
- **Old format:**
  - set `HasRelativePath="true"`, `RelativePathType` and `Name`
  - rebuild the `RelativePath` list (`..` written as `Dir=""`), and the `PathHint` list if present, keeping indentation plus a tab per element
  - reuse the old element Ids by position; new Ids are max + 1
  - write Ids if the document has any, or if Creator starts with "Ableton Live 10"
  - `Data`, `Type`, `FileSize` and `Crc` stay (Live 12 loads a stale `Data` fine)
- **`LastModDate`:** set to the int mtime of the destination; stale-path fixes leave it alone.
- **Quoting:** every rewritten value is written as `<Tag Value="…" />` with `& < > "` escaped.

Live itself does not check the fingerprint when loading, only in its automatic search; `-_RelaxFileManagerSearch` in `Options.txt` relaxes even that.
