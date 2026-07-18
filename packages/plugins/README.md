# WSRT plugin platform

`@wsrt/plugins` is the runtime-independent extension platform for WSRT. Core
loads only configured plugins and generic contribution contracts; integrations
such as Vite and Dashboard remain independently installable packages.

## Lifecycle

Plugins run in deterministic dependency order through:

```text
discover → configure → workspace → graph → providers → runtime
                                                        ↓
                                                    shutdown
```

Shutdown and `dispose()` run in reverse dependency order. A hook may only depend
on another plugin's earlier work when that plugin is declared in `requires`.
Lifecycle failures identify both plugin and stage, emit a diagnostic, mark the
plugin failed in snapshots, and stop initialization before partially configured
execution begins.

Hooks receive a read-only `PluginContext`: workspace root, normalized
configuration, scoped logging, diagnostics, events, and an explicit service map.
It deliberately does not expose mutable control-plane internals.

## Writing your first plugin

```ts
import { definePlugin } from '@wsrt/plugins'

const owner = { id: '@example/plugin-hello', version: '1.0.0' } as const

export default function hello(options: { greeting?: string } = {}) {
  return definePlugin({
    ...owner,
    name: 'Hello',
    description: 'A small example WSRT extension',
    capabilities: ['cli', 'configuration'],

    contributions: {
      configuration: [{
        id: owner.id,
        validate(value) {
          return value && typeof value !== 'object'
            ? [{
                code: 'hello.options.invalid',
                severity: 'error',
                message: 'Hello options must be an object',
              }]
            : []
        },
      }],

      cli: [{
        id: 'hello',
        path: 'hello',
        description: 'Print a greeting',
        owner,
        run(context, args) {
          context.logger.info(`${options.greeting ?? 'Hello'} ${args[0] ?? 'world'}`)
        },
      }],
    },

    lifecycle: {
      discover(context) {
        context.logger.info('Hello plugin discovered')
      },
      shutdown(context) {
        context.logger.info('Hello plugin stopping')
      },
    },
  })
}
```

Publish the package with a default factory or plugin object, then configure it:

```ts
plugins: [{
  provider: '@example/plugin-hello',
  options: { greeting: 'Welcome' },
}]
```

TypeScript configuration may instead import and instantiate the plugin directly:

```ts
import hello from '@example/plugin-hello'
export default defineSystem({ plugins: [hello({ greeting: 'Welcome' })] })
```

The CLI discovers its command before parsing, so `wsrt hello Ada` and generated
help work without editing `@wsrt/cli`.

## Metadata and dependencies

Every plugin requires a stable `id` and version. Optional metadata includes
`name`, `description`, and capability declarations. Capabilities are also
inferred from non-empty contribution registries for inspection.

```ts
requires: [{ id: '@example/base', minVersion: '2.1.0' }],
optional: [{ id: '@wsrt/plugin-dashboard', maxVersion: '3.0.0' }],
incompatible: ['@example/legacy'],
```

Required dependencies must exist and satisfy inclusive minimum/maximum bounds.
Installed optional dependencies are version-checked. Incompatibilities,
duplicates, invalid versions, missing requirements, and dependency cycles fail
deterministically with stable diagnostic codes.

## Contributions

The formal registries are:

- runtime, execution, readiness, and artifact providers;
- executable tools (`wsrt exec <tool>`);
- top-level CLI commands;
- workspace compilers and graph contributors;
- configuration validators;
- diagnostics;
- dashboard pages, widgets, panels, and actions;
- MCP tools, resources, and prompts;
- completion providers.

Contributions need stable IDs. User-facing CLI and executable contributions also
carry an owner identity, which is checked during session construction. Duplicate
IDs within a registry are rejected even when they come from different plugins.

## Discovery

Discovery is explicit and ordered exactly as configuration declares it. Providers
may be installed npm/workspace package names, relative local modules, absolute
paths, or `file:` URLs. Package names resolve from the workspace root rather than
from WSRT's installation. There is no implicit scanning or auto-injection.

`resolveWorkspacePluginsReport()` isolates import/factory failures into attributed
diagnostics. `resolveWorkspacePlugins()` is the strict variant for callers that
want immediate failure. Future registries can be added as discovery frontends
without changing plugin contracts.

## Testing

Construct plugins with `definePlugin`, then use `PluginSession` directly:

```ts
const session = new PluginSession([base(), feature()])
await session.initialize(testContext)
expect(session.snapshots()).toMatchSnapshot()
await session.dispose(testContext)
```

Test dependency bounds, every lifecycle hook, validation failures, duplicate
contributions, and reverse-order disposal. Prefer real contribution objects over
mocking the session itself.

## Debugging and observability

Use:

```bash
wsrt plugins
wsrt plugins inspect @example/plugin-hello
wsrt plugins graph
wsrt diagnostics
wsrt events
```

Control-plane snapshots expose metadata, lifecycle state, inferred capabilities,
registration IDs, dependencies, and attributed diagnostics—never executable
implementation objects. The Dashboard plugin renders this same public model.

## Best practices

- Keep package ownership narrow; framework-specific code belongs in its plugin.
- Declare ordering requirements instead of depending on configuration order.
- Validate options through `configuration`, without modifying user input.
- Communicate through context services, events, and explicit registries.
- Make hooks idempotent and disposal safe after partial initialization.
- Avoid module-level mutable singletons and hidden registration side effects.
- Keep contribution IDs stable across releases and version breaking contracts.
