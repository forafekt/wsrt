# System lifecycle dashboard

From the repository root:

```bash
pnpm install
pnpm build
pnpm run wsrt exec dashboard --config ./examples/system-lifecycle/wsrt.config.ts
```

Open `http://127.0.0.1:5177/__wsrt`. This example describes processes whose fixture applications are illustrative; the dashboard itself starts with nodes stopped. Press Ctrl+C for graceful shutdown.
