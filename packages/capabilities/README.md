# `@wsrt/capabilities`

Advanced, provisional TypeScript contracts for runtime providers, execution adapters, readiness, artifacts, and telemetry. Most application users should install `@wsrt/cli` and an integration plugin instead.

```bash
pnpm add @wsrt/capabilities
```

```ts
import type { RuntimeProvider } from "@wsrt/capabilities";
```

The root module is the only public entry point. It requires Node 22 or later and ESM. APIs are prerelease and may change before 1.0. See the repository README and `ARCHITECTURE.md`.
