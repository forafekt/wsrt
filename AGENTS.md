# AI Handoff: DevIntrospect Repository Analysis

[DevIntrospect](https://github.com/forafekt/devintrospect)

Generated using `dvi . --format ai -o AGENTS.md`

Use this as compact project context for maintenance, review, or implementation work.

Root: wsrt
Files: 228
Languages: JavaScript, TypeScript, JSON, YAML
Frameworks: none
Tools: pnpm, Biome

## Manifest Facts


## Hotspots

- pnpm-lock.yaml: 1891 lines
- packages/control-plane/src/index.ts: 1100 lines
- libraries/event-targets/src/index.ts: 745 lines
- libraries/console/src/transporters/console-ui.ts: 741 lines
- libraries/worker-pool/src/pool.ts: 528 lines
- libraries/di/README.md: 512 lines
- libraries/console/src/transporters/console.ts: 484 lines
- AGENTS.md: 438 lines
- packages/config/src/system.ts: 429 lines
- libraries/di/src/mod.ts: 405 lines
- libraries/commandline/README.md: 399 lines
- libraries/commandline/src/commandline.ts: 389 lines
- plugins/dashboard/src/server/dashboard-server.ts: 388 lines
- libraries/prompts/src/components/autocomplete.ts: 358 lines
- libraries/di/di.test.ts: 328 lines
- libraries/commandline/src/command.ts: 321 lines
- libraries/prompts/src/core/controllers/prompt.ts: 318 lines
- plugins/dashboard/src/client/main.ts: 317 lines
- plugins/dashboard/src/client/pages/index.ts: 310 lines
- packages/cli/src/cli.ts: 296 lines

# DevIntrospect: wsrt

## Summary

- Files: 228
- Directories: 80
- Size: 634.7 KB
- Lines: 22213

## Detected

- Languages: none
- Frameworks: none
- Tools: none
- Manifests: none

## Tree

```text
wsrt
├── adapters
│   └── .gitkeep
├── apps
│   └── .gitkeep
├── examples
│   ├── system-lifecycle
│   │   ├── apps
│   │   │   ├── api
│   │   │   │   └── server.mjs
│   │   │   └── web
│   │   │       └── server.mjs
│   │   ├── scripts
│   │   │   └── generate-contracts.mjs
│   │   ├── README.md
│   │   ├── wsrt.config.ts
│   │   └── wsrt.yaml
│   └── .gitkeep
├── libraries
│   ├── ansi-tools
│   │   ├── src
│   │   │   ├── ansi-colors.ts
│   │   │   ├── ansi-escape-codes.ts
│   │   │   ├── mod.ts
│   │   │   └── utils.ts
│   │   ├── LICENSE
│   │   ├── package.json
│   │   ├── README.md
│   │   └── tsconfig.json
│   ├── argparse
│   │   ├── src
│   │   │   └── mod.ts
│   │   ├── LICENSE
│   │   ├── package.json
│   │   ├── README.md
│   │   └── tsconfig.json
│   ├── commandline
│   │   ├── src
│   │   │   ├── command.ts
│   │   │   ├── commandline.ts
│   │   │   ├── create.ts
│   │   │   ├── deno.ts
│   │   │   ├── index.ts
│   │   │   ├── mod.ts
│   │   │   ├── option.ts
│   │   │   └── utils.ts
│   │   ├── LICENSE
│   │   ├── package.json
│   │   ├── README.md
│   │   └── tsconfig.json
│   ├── console
│   │   ├── src
│   │   │   ├── transporters
│   │   │   │   ├── console-ui.ts
│   │   │   │   ├── console.ts
│   │   │   │   ├── file.ts
│   │   │   │   ├── http.ts
│   │   │   │   └── mod.ts
│   │   │   ├── mod.ts
│   │   │   └── types.ts
│   │   ├── LICENSE
│   │   ├── package.json
│   │   ├── README.md
│   │   └── tsconfig.json
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
│   ├── event-targets
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
│       ├── README.md
│       ├── tsconfig.build.json
│       ├── tsconfig.json
│       └── tsconfig.test.json
├── packages
│   ├── artifacts
│   │   ├── src
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── capabilities
│   │   ├── src
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── cli
│   │   ├── src
│   │   │   ├── cli.ts
│   │   │   ├── executable.ts
│   │   │   ├── index.ts
│   │   │   └── logger.ts
│   │   ├── package.json
│   │   ├── README.md
│   │   └── tsconfig.json
│   ├── config
│   │   ├── src
│   │   │   ├── index.ts
│   │   │   ├── loader.ts
│   │   │   └── system.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── control-plane
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
│   ├── lifecycle
│   │   ├── src
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── mcp
│   │   ├── src
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── plugins
│       ├── src
│       │   ├── index.ts
│       │   └── resolver.ts
│       ├── package.json
│       └── tsconfig.json
├── plugins
│   ├── dashboard
│   │   ├── src
│   │   │   ├── client
│   │   │   │   ├── pages
│   │   │   │   │   └── index.ts
│   │   │   │   ├── state
│   │   │   │   │   └── store.ts
│   │   │   │   ├── transport
│   │   │   │   │   └── sse.ts
│   │   │   │   ├── main.ts
│   │   │   │   ├── router.ts
│   │   │   │   └── styles.ts
│   │   │   ├── plugin
│   │   │   │   └── index.ts
│   │   │   ├── server
│   │   │   │   ├── dashboard-server.ts
│   │   │   │   ├── index.ts
│   │   │   │   └── snapshots.ts
│   │   │   ├── shared
│   │   │   │   └── contracts.ts
│   │   │   ├── api.ts
│   │   │   └── index.ts
│   │   ├── package.json
│   │   ├── README.md
│   │   └── tsconfig.json
│   ├── vite
│   │   ├── src
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── .gitkeep
├── runtimes
│   └── node
│       ├── src
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
├── scripts
│   └── check-architecture.mjs
├── tests
│   ├── commandline-cli.test.mjs
│   ├── config-outputs.test.mjs
│   ├── dashboard-client.test.mjs
│   ├── hardening.test.mjs
│   ├── plugin-architecture.test.mjs
│   └── system-lifecycle.test.mjs
├── tooling
│   └── .gitkeep
├── .example.wsrt.yml
├── .gitignore
├── AGENTS.md
├── ARCHITECTURE.md
├── biome.json
├── EXTENSIONS.md
├── package.json
├── PLANS.md
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── README.md
├── tsconfig.package.json
└── wsrt.config.ts
```

## Hotspots

- pnpm-lock.yaml: 1891 lines
- packages/control-plane/src/index.ts: 1100 lines
- libraries/event-targets/src/index.ts: 745 lines
- libraries/console/src/transporters/console-ui.ts: 741 lines
- libraries/worker-pool/src/pool.ts: 528 lines
- libraries/di/README.md: 512 lines
- libraries/console/src/transporters/console.ts: 484 lines
- AGENTS.md: 438 lines
- packages/config/src/system.ts: 429 lines
- libraries/di/src/mod.ts: 405 lines
- libraries/commandline/README.md: 399 lines
- libraries/commandline/src/commandline.ts: 389 lines
- plugins/dashboard/src/server/dashboard-server.ts: 388 lines
- libraries/prompts/src/components/autocomplete.ts: 358 lines
- libraries/di/di.test.ts: 328 lines
- libraries/commandline/src/command.ts: 321 lines
- libraries/prompts/src/core/controllers/prompt.ts: 318 lines
- plugins/dashboard/src/client/main.ts: 317 lines
- plugins/dashboard/src/client/pages/index.ts: 310 lines
- packages/cli/src/cli.ts: 296 lines
