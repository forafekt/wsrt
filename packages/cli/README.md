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
