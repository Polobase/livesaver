# Releasing

Publishing, pushing and tagging are manual steps that only the maintainer runs (npm login required;
create the npm organization `livesaver` first).

1. **Green state:** `bun install --frozen-lockfile && bun run build && bun run check && bun test`,
   plus CI (macOS, Ubuntu, Node 22/24 smoke tests, publint + arethetypeswrong).
2. **Version:**
   ```sh
   bunx changeset version        # bumps versions, writes CHANGELOG.md files (all packages move together)
   bun run release:sync-lock     # copies the versions into bun.lock (bun publish reads workspace:* from it)
   bun install --frozen-lockfile
   ```
3. **Dry run:** for each package, `bun pm pack --destination /tmp/livesaver-pack` and check that
   `files` holds only `dist/`, `src/`, `README.md`, `LICENSE`, `package.json`, and that `workspace:*`
   became real versions.
4. **Publish** (dependency order): `@livesaver/xml`, `@livesaver/core`, `@livesaver/node`,
   `@livesaver/ops`, then `livesaver`: `cd packages/<name> && bun publish --access public`.
5. **Tag:** `git tag v0.1.0 && git push --tags`.
