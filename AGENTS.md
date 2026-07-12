# AI Handoff: DevIntrospect Repository Analysis

Generated using `/home/jonnydoyle/.local/bin/dvi . --format ai -o AGENTS.md`

Use this as compact project context for maintenance, review, or implementation work.

Root: wsrt
Files: 251
Languages: JavaScript, TypeScript, JSON, YAML
Frameworks: none
Tools: pnpm, biome

## Manifest Facts


## Hotspots

- pnpm-lock.yaml: 1984 lines
- tests/wsrt.test.mjs: 1277 lines
- libraries/events/src/index.ts: 745 lines
- packages/types/src/index.ts: 732 lines
- README.md: 677 lines
- libraries/worker-pool/src/pool.ts: 528 lines
- plugins/plugin-dashboard/src/index.ts: 521 lines
- libraries/di/README.md: 512 lines
- libraries/di/src/mod.ts: 405 lines
- packages/config/src/module-reference.ts: 405 lines
- libraries/prompts/src/components/autocomplete.ts: 358 lines
- packages/config/src/loader.ts: 353 lines
- libraries/commandline/src/commandline.ts: 335 lines
- libraries/commandline/README.md: 335 lines
- libraries/di/di.test.ts: 328 lines
- libraries/prompts/src/core/controllers/prompt.ts: 318 lines
- packages/runtime/src/index.ts: 312 lines
- libraries/commandline/src/command.ts: 299 lines
- plugins/plugin-dashboard/src/api.ts: 296 lines
- packages/config/src/resolver.ts: 279 lines

# DevIntrospect: WSRT

## Summary

- Files: 251
- Directories: 105
- Size: 741.6 KB
- Lines: 24371

## Detected

- Languages: none
- Frameworks: none
- Tools: none
- Manifests: none

## Tree

```text
wsrt
├── adapters
│   ├── adapter-command
│   │   ├── src
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── adapter-composite
│   │   ├── src
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── adapter-core
│   │   ├── src
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── adapter-node
│   │   ├── src
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── adapter-vite
│   │   ├── src
│   │   │   ├── config.ts
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── .gitkeep
├── apps
│   └── .gitkeep
├── examples
│   └── .gitkeep
├── libraries
│   ├── argparse
│   │   ├── src
│   │   │   └── mod.ts
│   │   ├── LICENSE
│   │   └── README.md
│   ├── commandline
│   │   ├── src
│   │   │   ├── command.ts
│   │   │   ├── commandline.ts
│   │   │   ├── deno.ts
│   │   │   ├── mod.ts
│   │   │   ├── option.ts
│   │   │   └── utils.ts
│   │   ├── LICENSE
│   │   └── README.md
│   ├── decouple
│   │   ├── src
│   │   │   ├── sources
│   │   │   │   ├── defaults.ts
│   │   │   │   ├── deno-env.ts
│   │   │   │   ├── dot-env.ts
│   │   │   │   ├── dot-envs.ts
│   │   │   │   ├── file-json.ts
│   │   │   │   └── memory.ts
│   │   │   ├── casters.ts
│   │   │   ├── decouple.ts
│   │   │   ├── errors.ts
│   │   │   ├── layer-strict.ts
│   │   │   ├── layer.ts
│   │   │   ├── mod.ts
│   │   │   ├── schema.ts
│   │   │   └── var.ts
│   │   ├── LICENSE
│   │   └── README.md
│   ├── di
│   │   ├── src
│   │   │   └── mod.ts
│   │   ├── .gitignore
│   │   ├── di.test.ts
│   │   ├── LICENSE
│   │   └── README.md
│   ├── events
│   │   ├── src
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── prompts
│   │   ├── src
│   │   │   ├── components
│   │   │   │   ├── autocomplete.ts
│   │   │   │   ├── box.ts
│   │   │   │   ├── common.ts
│   │   │   │   ├── confirm.ts
│   │   │   │   ├── group-multi-select.ts
│   │   │   │   ├── group.ts
│   │   │   │   ├── limit-options.ts
│   │   │   │   ├── log.ts
│   │   │   │   ├── messages.ts
│   │   │   │   ├── mod.ts
│   │   │   │   ├── multi-select.ts
│   │   │   │   ├── note.ts
│   │   │   │   ├── password.ts
│   │   │   │   ├── path.ts
│   │   │   │   ├── progress-bar.ts
│   │   │   │   ├── select-key.ts
│   │   │   │   ├── select.ts
│   │   │   │   ├── spinner.ts
│   │   │   │   ├── stream.ts
│   │   │   │   ├── task-log.ts
│   │   │   │   ├── task.ts
│   │   │   │   └── text.ts
│   │   │   ├── core
│   │   │   │   ├── controllers
│   │   │   │   │   ├── autocomplete.ts
│   │   │   │   │   ├── confirm.ts
│   │   │   │   │   ├── group-multiselect.ts
│   │   │   │   │   ├── multi-select.ts
│   │   │   │   │   ├── password.ts
│   │   │   │   │   ├── prompt.ts
│   │   │   │   │   ├── select-key.ts
│   │   │   │   │   ├── select.ts
│   │   │   │   │   └── text.ts
│   │   │   │   ├── utils
│   │   │   │   │   ├── fstring
│   │   │   │   │   │   ├── mod.ts
│   │   │   │   │   │   ├── types.ts
│   │   │   │   │   │   └── utils.ts
│   │   │   │   │   ├── key.ts
│   │   │   │   │   ├── mod.ts
│   │   │   │   │   ├── settings.ts
│   │   │   │   │   └── string.ts
│   │   │   │   ├── mod.ts
│   │   │   │   └── types.ts
│   │   │   └── mod.ts
│   │   ├── LICENSE
│   │   └── README.md
│   └── worker-pool
│       ├── examples
│       │   ├── basic-add.mjs
│       │   ├── basic-worker.mjs
│       │   ├── cpu-heavy-worker.mjs
│       │   ├── cpu-heavy.mjs
│       │   ├── dynamic-scaling.mjs
│       │   ├── node-server-worker.mjs
│       │   ├── node-server.mjs
│       │   ├── timeout-cancellation.mjs
│       │   ├── transferable-buffer.mjs
│       │   └── transferable-worker.mjs
│       ├── src
│       │   ├── errors.ts
│       │   ├── events.ts
│       │   ├── index.ts
│       │   ├── logger.ts
│       │   ├── metrics.ts
│       │   ├── pool.ts
│       │   ├── queue.ts
│       │   ├── serializer.ts
│       │   ├── types.ts
│       │   ├── worker-protocol.ts
│       │   └── worker.ts
│       ├── tests
│       │   ├── fixtures
│       │   │   └── tasks.mjs
│       │   ├── typecheck.ts
│       │   └── worker-pool.test.mjs
│       ├── package.json
│       └── README.md
├── packages
│   ├── adapter-command
│   ├── adapter-composite
│   ├── adapter-core
│   ├── adapter-node
│   ├── adapter-vite
│   ├── artifacts
│   │   ├── src
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── cli
│   │   ├── src
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── config
│   │   ├── src
│   │   │   ├── define.ts
│   │   │   ├── index.ts
│   │   │   ├── loader.ts
│   │   │   ├── merge.ts
│   │   │   ├── module-reference.ts
│   │   │   └── resolver.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── core
│   │   ├── src
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── diagnostics
│   │   ├── src
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── environment
│   │   ├── src
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── events
│   │   ├── src
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── graph
│   │   ├── src
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── mcp
│   │   ├── src
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── plugin-dashboard
│   ├── plugin-git
│   ├── plugin-typescript
│   ├── plugin-utils
│   ├── plugin-vite
│   ├── plugin-workspace
│   ├── plugins
│   │   ├── src
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── reports
│   │   ├── src
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── resolve
│   │   ├── src
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── runtime
│   │   ├── src
│   │   │   ├── builtins.ts
│   │   │   ├── index.ts
│   │   │   ├── model.ts
│   │   │   ├── packages.ts
│   │   │   ├── projects.ts
│   │   │   ├── query.ts
│   │   │   └── registries.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── services
│   │   ├── src
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── sync
│   │   ├── src
│   │   │   ├── json.ts
│   │   │   ├── manifests.ts
│   │   │   └── tsconfig.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── types
│   │   ├── src
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── virtual
│       ├── src
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
├── plugins
│   ├── plugin-dashboard
│   │   ├── src
│   │   │   ├── app
│   │   │   │   ├── client
│   │   │   │   │   ├── components
│   │   │   │   │   │   ├── wsrt-app.ts
│   │   │   │   │   │   ├── wsrt-graph.ts
│   │   │   │   │   │   ├── wsrt-sidebar.ts
│   │   │   │   │   │   └── wsrt-topbar.ts
│   │   │   │   │   ├── lib
│   │   │   │   │   │   └── html.ts
│   │   │   │   │   ├── pages
│   │   │   │   │   │   ├── aliases-page.ts
│   │   │   │   │   │   ├── artifacts-page.ts
│   │   │   │   │   │   ├── config-page.ts
│   │   │   │   │   │   ├── diagnostics-page.ts
│   │   │   │   │   │   ├── exports-page.ts
│   │   │   │   │   │   ├── graph-page.ts
│   │   │   │   │   │   ├── mcp-page.ts
│   │   │   │   │   │   ├── overview-page.ts
│   │   │   │   │   │   ├── packages-page.ts
│   │   │   │   │   │   ├── plugin-page.ts
│   │   │   │   │   │   ├── plugins-page.ts
│   │   │   │   │   │   ├── projects-page.ts
│   │   │   │   │   │   ├── services-page.ts
│   │   │   │   │   │   ├── settings-page.ts
│   │   │   │   │   │   ├── tasks-page.ts
│   │   │   │   │   │   ├── timeline-page.ts
│   │   │   │   │   │   └── virtual.ts
│   │   │   │   │   ├── api.ts
│   │   │   │   │   ├── main.ts
│   │   │   │   │   ├── router.ts
│   │   │   │   │   ├── state.ts
│   │   │   │   │   └── types.ts
│   │   │   │   ├── dashboard-html.ts
│   │   │   │   ├── index.ts
│   │   │   │   ├── README.md
│   │   │   │   └── styles.ts
│   │   │   ├── types
│   │   │   │   └── index.ts
│   │   │   ├── api.ts
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── plugin-git
│   │   ├── src
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── plugin-typescript
│   │   ├── src
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── plugin-utils
│   │   ├── src
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── plugin-vite
│   │   ├── src
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── plugin-workspace
│   │   ├── src
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── .gitkeep
├── scripts
├── tests
│   └── wsrt.test.mjs
├── tooling
│   └── .gitkeep
├── .example.wsrt.yml
├── .gitignore
├── biome.json
├── package.json
├── PLANS.md
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── README.md
├── tsconfig.package.json
└── wsrt.config.ts
```

## Hotspots

- pnpm-lock.yaml: 1984 lines
- tests/wsrt.test.mjs: 1277 lines
- libraries/events/src/index.ts: 745 lines
- packages/types/src/index.ts: 732 lines
- README.md: 677 lines
- libraries/worker-pool/src/pool.ts: 528 lines
- plugins/plugin-dashboard/src/index.ts: 521 lines
- libraries/di/README.md: 512 lines
- libraries/di/src/mod.ts: 405 lines
- packages/config/src/module-reference.ts: 405 lines
- libraries/prompts/src/components/autocomplete.ts: 358 lines
- packages/config/src/loader.ts: 353 lines
- libraries/commandline/src/commandline.ts: 335 lines
- libraries/commandline/README.md: 335 lines
- libraries/di/di.test.ts: 328 lines
- libraries/prompts/src/core/controllers/prompt.ts: 318 lines
- packages/runtime/src/index.ts: 312 lines
- libraries/commandline/src/command.ts: 299 lines
- plugins/plugin-dashboard/src/api.ts: 296 lines
- packages/config/src/resolver.ts: 279 lines
