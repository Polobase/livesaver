---
'livesaver': minor
'@livesaver/core': minor
'@livesaver/plugins': minor
'@livesaver/node': minor
'@livesaver/ops': minor
---

Project management: `livesaver status` marks every set and project folder in Finder (a progress
tag, completeness tags, a one-line comment with the facts) and keeps an optional rating sheet in
sync; `livesaver reorg` sorts project folders into status folders by their decision tag;
`livesaver move` moves sets saved into another song's project into a project of their own. The
plug-in inventory knows which plug-ins are installed and whether they run natively or only under
Rosetta. Every `--apply` is journaled, and `livesaver undo` reverses tags, comments, the rating
sheet and moves.
