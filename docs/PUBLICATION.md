# Publication strategy

WSRT's first release uses the prerelease version declared by the root `package.json`. The public `wsrt` distribution and every public `@wsrt/*` package move together so consumers cannot accidentally combine incompatible control-plane, plugin, runtime, and telemetry contracts. `pnpm version:sync` is the explicit version-editing command; builds and checks do not mutate manifests. SemVer applies to the package set; before 1.0, a minor release may contain breaking public API changes and a patch release must remain compatible. Deprecations should be documented for at least one minor release when practical. Plugin and telemetry protocol changes are versioned with the package set and must reject unsupported versions explicitly.

Every manifest is classified in `scripts/public-packages.mjs` as `public-fixed`, `private-tooling`, or `fixture`. No independently versioned public package exists today. New packages must be added to that catalog in the same change as their manifest.

## Publication matrix

| Package | Publish? | Audience | Stability | Entry points | Dependencies | Notes |
| --- | ---: | --- | --- | --- | --- | --- |
| `wsrt` | Yes | Most users | Alpha | `.`, `wsrt` bin | cli, config, control-plane, runtime-node | Batteries-included Node.js distribution; no optional plugins |
| `@wsrt/cli` | Yes | Advanced/user-facing | Alpha | `.`, `wsrt` bin | commandline, config, console, control-plane, plugins, workspace | Official CLI implementation |
| `@wsrt/config` | Yes | User-facing | Alpha | `.` | graph, esbuild, yaml | Typed config and loader |
| `@wsrt/control-plane` | Yes | Advanced | Alpha | `.` | capabilities, config, graph, lifecycle, plugins, runtime-node | Programmatic orchestration |
| `@wsrt/capabilities` | Yes | Advanced | Provisional | `.` | none | Provider contracts |
| `@wsrt/workspace` | Yes | User-facing | Alpha | `.` | yaml | Workspace inspection and projections |
| `@wsrt/plugins` | Yes | Plugin authors | Alpha | `.` | capabilities | Plugin contracts and consumer-relative loading |
| `@wsrt/runtime-node` | Yes | Runtime provider | Alpha | `.` | capabilities | Default runtime |
| `@wsrt/plugin-vite` | Yes | Plugin users | Alpha | `.`, `./vite` | capabilities, plugins, runtime-node, workspace, Vite | Integration and native Vite entry |
| `@wsrt/plugin-dashboard` | Yes | Plugin users | Alpha | `.` | control-plane, plugins | Binds to loopback by default |
| `@wsrt/mcp` | Yes | Advanced | Alpha | `.` | MCP SDK, control-plane, zod | Transport supplied by consumer |
| `@wsrt/graph` | Yes | Advanced/internal-facing | Provisional | `.` | none | Required public dependency of config/control-plane |
| `@wsrt/lifecycle` | Yes | Advanced/internal-facing | Provisional | `.` | graph | Required public dependency of control-plane |
| `@wsrt/commandline` | Yes | Advanced/internal-facing | Provisional | `.` | argparse, event-targets | CLI dependency closure |
| `@wsrt/argparse` | Yes | Advanced/internal-facing | Provisional | `.` | none | CLI dependency closure |
| `@wsrt/event-targets` | Yes | Advanced/internal-facing | Provisional | `.` | none | CLI dependency closure |
| `@wsrt/console` | Yes | Advanced/internal-facing | Provisional | `.`, `./transporters` | ansi-tools | CLI dependency closure |
| `@wsrt/ansi-tools` | Yes | Advanced/internal-facing | Provisional | `.` | none | CLI dependency closure |
| `@wsrt/di` | Yes | Advanced/internal-facing | Provisional | `.` | none | Explicit fixed-version public utility |
| `@wsrt/runtime-rust` | No | Runtime provider | Experimental source-only | none published | capabilities, native Rust host | No npm binary distribution yet; Rust is not a default dependency |
| `@wsrt/artifacts` | No | Implementation | Experimental | none | none | Empty/early abstraction; avoid API commitment |
| `@wsrt/diagnostics` | No | Implementation | Experimental | none | none | Not required by public dependency closure |
| `@wsrt/environment` | No | Implementation | Experimental | none | none | Not required by public dependency closure |
| `@wsrt/events` | No | Implementation | Experimental | none | none | Not required by public dependency closure |
| `@wsrt/worker-pool` | No | Unrelated library | Independent | none | none | Not part of initial WSRT product |
| decouple and prompts | No package | Repository libraries | Independent | none | n/a | Development/source libraries, outside this release |
| adapters/apps/testing helpers | No package | Development-only | n/a | none | n/a | No publishable implementation exists |

There is no `@wsrt/runtime-rust` npm release until CI can build, sign, package, and test platform binaries without requiring consumers to install Rust. A platform-specific optional-package design is the likely future direction. There is currently no runtime-rust platform package or testing helper package.

## Compatibility

| Area | First-release support |
| --- | --- |
| Node.js | 22 and 24; ESM only (22 is the declared minimum) |
| Package managers | pnpm 11 tested; npm installation is intended but packed CI uses pnpm initially |
| TypeScript | 5.9 used to build; consumers need TypeScript only for typed config authoring |
| Linux | CI and packed-consumer target |
| macOS / Windows | Provisional until the release matrix exercises packed installs |
| Vite | 8.x direct dependency in the alpha |
| Browser | Current evergreen browsers for dashboard assets; no library browser entry points |
| Rust runtime | Deferred; source checkout experimentation only |

## Package requirements

Public packages require complete npm metadata, explicit ESM exports, Node 22 engines, an allowlisted `files` set, public/provenance publication settings, and a package README carrying the standard early-development warning near its heading. Runtime imports belong in runtime dependencies; workspace ranges are permitted in source manifests only when pnpm rewrites them to concrete ranges in the packed manifest. Core packages must never depend on concrete plugins.

The repository owner has not selected a license. This is a hard publication blocker: existing `ISC` manifest metadata is not treated as legal approval. Once ownership chooses an SPDX license, add its canonical text at root `LICENSE` and update all public manifest identifiers consistently. Packing then temporarily copies that canonical file into each package, validates the tarball byte-for-byte, and restores the working tree, preventing package copies from drifting.

The package quality script is the executable source of truth. It checks classification completeness, names, private flags, fixed versions, README warnings, metadata and access, dependency policy, exports and entry points, CLI permissions, package-name uniqueness, and canonical license consistency. The architecture check enforces dependency cycles and plugin boundaries.

## Adding a public package

Add its manifest and source, a substantive README with the standard warning, explicit exports and files, tests, and a `public-fixed` catalog record. Keep plugin implementations outside core. Run `pnpm build`, `pnpm release:check`, `pnpm release:pack`, and `pnpm external-consumer:test`; add its intended imports or binary behavior to the packed consumer fixture when the generic import checks are insufficient.
