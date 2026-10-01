---
'livesaver': minor
'@livesaver/ops': minor
---

Codemods: `livesaver run <codemod> <folders> [--apply]` runs a built-in (`set-tempo`,
`mastering-off`) or your own TypeScript/JavaScript codemod over sets. Codemods describe edits through
typed views (tracks, devices, tempo, locators) and byte-exact patch primitives; livesaver checks the
result, backs up, journals, and `livesaver undo` reverses it.
