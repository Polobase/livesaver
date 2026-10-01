---
'livesaver': minor
'@livesaver/plugins': minor
'@livesaver/node': minor
'@livesaver/ops': minor
---

Plug-in inventory and audit: `livesaver plugins list` shows the installed plug-ins (formats, native
or Rosetta, versions, `moduleinfo.json`); `livesaver plugins audit` reports missing and Rosetta-only
plug-ins, the same plug-in installed natively in another format, VST2 plug-ins whose VST3 is
installed, plug-ins no set uses, and with `--uninstall <name>` what would break.
