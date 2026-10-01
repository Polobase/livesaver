---
'livesaver': minor
'@livesaver/catalog': minor
'@livesaver/core': minor
'@livesaver/node': minor
'@livesaver/ops': minor
---

Catalog and search: `livesaver index` keeps a SQLite catalog of every set (analysis, plug-ins,
sample references; later runs read only changed sets and re-check the rest in under a second),
`livesaver find` searches it with a small query language
(`plugin:serum bpm:120..128 stage:arranged missing:samples "night drive"`), and `livesaver sql` runs
read-only SQL on it.
