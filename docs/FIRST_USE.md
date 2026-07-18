# First use from another repository

WSRT is an alpha. Use the `next` dist-tag and pin the package set together.

```bash
pnpm add -D @wsrt/cli@next @wsrt/config@next @wsrt/plugin-vite@next
```

Create `wsrt.config.ts`:

```ts
import { defineSystem } from "@wsrt/config";
import vite from "@wsrt/plugin-vite";

export default defineSystem({
  schemaVersion: "1",
  name: "my-workspace",
  plugins: [vite({ workspace: { discover: true, aliases: true } })],
  tasks: { check: { command: { command: "pnpm", args: ["test"] } } },
});
```

Then run:

```bash
pnpm wsrt validate
pnpm wsrt workspace inspect
pnpm wsrt run check
pnpm wsrt exec vite -- build
```

Install `@wsrt/plugin-dashboard@next`, add it to `plugins`, and run `pnpm wsrt exec dashboard -- --no-open` when a local UI is useful. Package-name plugin references are resolved from the consumer workspace. Configs and plugins are executable code and share the current user's permissions; use only trusted sources.
