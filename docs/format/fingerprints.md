# Fingerprints

## `OriginalCrc` / `Crc` = CRC-16/UMTS over the first 16 KB
- Algorithm: width 16, poly `0x8005`, init `0`, no reflection, xorout `0` (a.k.a. CRC-16/BUYPASS).
- Check value: `"123456789"` → `0xFEE8`.
- Computed over the first `min(size, 16384)` bytes. Paired with the file size:
  - new format: `OriginalFileSize` / `OriginalCrc`
  - old format: `SearchHint/FileSize` / `Crc` (with `MaxCrcSize` = 16384)
- `0 / 0` means "no fingerprint". Generators often write that, and Live still loads such files.

Evidence (research agent, 2026-09-30): the CRC was recomputed for files Live had saved, at the exact commit where the file size matched.

| Saved by | File | Size | Stored | Computed |
|---|---|---|---|---|
| Live 9.6 (`SearchHint/Crc`) | m4l-connection-kit `OSC Leap Motion.amxd` | 234,834 | 63076 | 63076 |
| Live 11.3.13 | maxdevtools `Test.amxd` | 19,428 | 37031 | 37031 (the whole-file CRC would be 42025) |
| Live 12.0 | maxdevtools `DoneLoading.amxd` | 3,520 | 15618 | 15618 |

The fixture `fixtures/samples/Lib1/Kick/1.wav` gives `(2000324, 17226)`. Around 31 other CRC-16 variants and byte ranges were tried, and none matched. abletoolz's README still lists this as unsolved.

## Exceptions used when matching
- **Vendor re-saves.** Native Instruments and Ableton re-saved library files with a padding byte or appended metadata, which changes only the RIFF/FORM size field in the first 16 KB.
  - Recompute the CRC with bytes 4–8 set to `size − k` for `k ∈ {7, 8, 9}` (`<I` for RIFF, `>I` for FORM), where `size` is the *stored* size.
  - This counts as verified.
  - Only for samples with `crc ≠ 0`, candidates inside a vendor root (Factory Packs, Core Library, `vendorLibraries` such as `/Users/Shared`), and `0 < |Δsize| ≤ 8192`.
- **Pack samples.** Ableton updated pack files in place, so the same size is enough.
  - Applies when the ref is a pack sample (`LivePackName` set, type 5, or "core library"/"factory packs" in the stored path, lowercased) or the candidate lies in an installed pack.
  - Marked **uncertain**.
- **crc = 0 and size > 0:** a size match counts as **certain**.
- **Max devices:** exact fingerprint only. Without a stored size, all candidates must be byte-identical (`content_hash`).

## Audio hash (tie-breaking)
When several candidates tie on the longest path ending, they are accepted only if their **audio data** is identical:
- SHA-1 over only the `fmt ` + `data` chunks (RIFF, little-endian sizes) or `COMM` + `SSND` (FORM, big-endian); chunks are padded to even lengths.
- Otherwise, a SHA-1 of the whole file.

This reduced ambiguous matches on the real library from 2,285 to 2.
