# Ableton Live file formats — what livesaver relies on

Facts collected from Live's own files (verified against real sets) and public research
(Steinberg VST3 SDK, JUCE, Ableton's maxdevtools). Each page names its sources.

| Page | Contents |
|---|---|
| [containers.md](containers.md) | gzip-XML documents, binary legacy files, `.amxd`, `.asd`, `.alp`, id spaces |
| [versions.md](versions.md) | `<Ableton>` root attributes per Live version |
| [fileref.md](fileref.md) | FileRef formats (Live 8.2–10 vs 11+), RelativePathType, `Data`, patching rules |
| [fingerprints.md](fingerprints.md) | `OriginalCrc` = CRC-16/UMTS over 16 KB, vendor/pack exceptions, audio hash |
| [live-setup.md](live-setup.md) | Live app resources, `Library.cfg`, pack `Properties.cfg`, `filerefmap.db`, Live's databases |
| [plugins.md](plugins.md) | VST2/VST3/AU identity, VST2→VST3 UID derivation, state migration |
| [finder.md](finder.md) | Finder tags and comments, plug-in bundles, Live's plug-in database |

Rule for GPL sources (abletoolz, DawVert): facts only, never code.
