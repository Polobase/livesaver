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

Counts in one real library (917 sets): 3 = 296,399; 1 = 289,371; 5 = 262,209; 0 = 56,934; 6 = 17,519; 2 = 398; 7 = 385.

`FileRef/Type` is 1 in every reference whose `Data` holds a path of Windows and 2 in every one whose `Data` is a Mac alias (see [Windows](#windows) for the counts). That suggests it records the system the set was saved on, but this is unverified. livesaver leaves it as it is, on either system.

## Windows
What references with a path of Windows store, counted read-only in one real library on a Mac (3,806 sets and backups):
- **Old format (Live 9 and 10 on Windows):** 2,938,985 references in 2,103 sets hold a path of Windows in `Data`, with backslashes (`E:\Samples\Kick\1.wav`). Every one has `Type` 1. Where there is a `PathHint` (2,464,731 of them), it holds the folders of that path **without the drive**: its first element is never `E:`. (The 468,425 references whose `Data` is a Mac alias all have `Type` 2.)
- **New format:** 22 references hold a drive in `Path`, written with forward slashes (`C:/Samples/Kick/1.wav`). All have `RelativePathType` 0, the file's name alone as `RelativePath`, and `Type` 2: by that they were written on a Mac, when a newer Live saved a set that came from Windows. So Live writes a path with a drive into the new format with forward slashes; what a Live on Windows writes beside it (`Type`, `RelativePath`) was not seen.

livesaver handles every path with `/` between its parts, and takes a drive as a root of its own (`C:/Users/…`): `posix.slashed`, `posix.drive` and the drive-aware `normpath`, `relpath` and `commonpath` of `@livesaver/core`.
- A stored path of Windows is tried as a file only where the project itself lies on a drive, and a stored path of a Mac only where it does not: Windows would open `/Users/you/x.wav` as a file of its current drive, which is not the file the set means.
- What a path says of Live's own content holds on both: `/Applications/Ableton Live 9 Suite.app/Contents/App-Resources/<rest>` and `C:/ProgramData/Ableton/Live 9 Suite/Resources/<rest>` are tried as `<rest>` in the content of the Live at hand (the second where the project lies on a drive; that folder is as Ableton documents it, no set of the library names it).
- Written on Windows: `Path` with the drive and forward slashes, and in the old format the `PathHint` without the drive. `Type` stays.

None of this was tried in Live on Windows (see [the guide](../guide/windows.md)).

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
