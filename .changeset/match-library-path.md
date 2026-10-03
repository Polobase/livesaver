---
'livesaver': minor
'@livesaver/ops': minor
---

`doctor` and `collect` take `--match-library-path`: when no fingerprint matches, a vendor library
file is accepted by its name and place in the library (the file name plus three folders) if its
size differs by at most 16 bytes. This relinks samples shorter than Live's 16 KB CRC window whose
tags changed between library versions. Such changes are reported as uncertain.

The summary of `doctor` and `collect` now also lists the most common sources of found samples
(library, pack, project or folder), next to the sources of missing ones.
