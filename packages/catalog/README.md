# @livesaver/catalog

A searchable catalog of Ableton Live projects: an incremental index of sets, plug-ins and sample
references in SQLite (with FTS5), and the `find` query language
(`plugin:serum bpm:120..128 stage:arranged missing:samples "night drive"`). Runtime-agnostic: the
database comes in through a small synchronous SQL port (`bun:sqlite`, `node:sqlite`).

Part of [livesaver](https://github.com/Polobase/livesaver).
