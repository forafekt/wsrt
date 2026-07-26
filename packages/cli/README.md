# @wsrt/cli

> [!WARNING]
> This package is part of WSRT, which is under active early development. APIs, configuration, behavior, and package boundaries may change without notice. It is not currently recommended for production or critical workloads.

The official WSRT command line is the reference application for
`@wsrt/commandline`. Its command tree is declarative, actions are awaited, and
the control plane is created lazily only after parsing and validation.

```sh
wsrt --help
wsrt inspect --json
wsrt validate
wsrt run <task>
wsrt exec --list
wsrt exec dashboard -- --port 5177
wsrt completion zsh
```

Create a discoverable starter configuration (YAML by default), or choose any
supported YAML, JSON, TypeScript, or JavaScript extension:

```sh
wsrt init
wsrt init --format ts
wsrt init --output config/wsrt.json
wsrt init --force
```

Existing files are protected unless `--force` is supplied. `--output` infers its
format; a conflicting `--format` is rejected.

YAML, YML, and JSON starters use `null` for optional top-level sections. At that
boundary `null` means “not configured” and normalizes like omission; required
values such as `name`, and required fields inside declared items, remain
non-nullable. YAML starters include a YAML language-server directive and JSON
starters include `$schema`.

Convert a discovered or explicit configuration through WSRT's normal loading,
validation, and normalization pipeline:

```sh
wsrt config convert --to json
wsrt config convert wsrt.yaml --to ts
wsrt config convert --from wsrt.config.ts --output wsrt.yaml
wsrt config convert --to yaml --force
```

Supported extensions are `.yaml`, `.yml`, `.json`, `.ts`, `.mts`, `.cts`, `.js`,
`.mjs`, and `.cjs`. JavaScript and TypeScript sources execute through the normal
trusted-local-config loader, so conversion captures their resolved value at that
moment. Comments, imports, functions, and other source-level constructs are not
preserved; values that cannot be represented safely cause a path-specific error.

Configuration inspection has two deliberately different depths:

```sh
wsrt config validate
wsrt config validate wsrt.yaml --json
wsrt config test
wsrt config test wsrt.config.ts --plan
wsrt config test --check-commands
```

`validate` performs loading, structural and semantic normalization, reference
checks, graph compilation, and cycle detection. It never resolves plugins or
creates runtime resources. `test` additionally resolves plugin packages and
runtime/adapter registrations, checks working directories, and builds deterministic
startup and shutdown stages, then disposes resolved plugins. It does not create
runtime instances or start nodes. Environment-dependent command checks are opt-in;
port and network flags only inspect supported declarative targets and never send
application requests.

WSRT bundles a deterministic JSON Schema Draft 2020-12 artifact:

```sh
wsrt config schema
wsrt config schema --stdout
wsrt config schema --output .wsrt/wsrt.schema.json
wsrt config schema --check
```

The artifact is owned by `@wsrt/config` at
`packages/config/schema/wsrt.schema.json` and is publicly exported as
`@wsrt/config/schema`. `$schema` is an accepted public editor-association property
and is ignored during normalization.

Global workspace options are accepted by every command:

```text
-r, --root <directory>  Workspace root
-c, --config <file>     WSRT configuration file
--json                  Machine-readable output
```

Arguments after `--` on `exec` belong to the plugin executable and are
validated by that contribution. Long-running lifecycle and plugin handles are
closed on `SIGINT` or `SIGTERM`.

Programmatic consumers can import `createWsrtCli` to inspect or extend the
command model, or `run` to execute it with a Node-style argv array.
