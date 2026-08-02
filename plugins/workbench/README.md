# @wsrt/plugin-workbench

> [!WARNING]
> This package is part of WSRT, which is under active early development. APIs, configuration, behavior, and package boundaries may change without notice. It is not currently recommended for production or critical workloads.

WSRT Workbench is an authoritative semantic interface and operating layer for software workspaces.

```ts
plugins: [{
  provider: "@wsrt/plugin-workbench",
  options: { host: "127.0.0.1", port: 5178, basePath: "/__wsrt/workbench" }
}]
```

Run `wsrt exec workbench`. Mutations are enabled by default and always require confirmation in the UI.
Set `mutations: false` for a read-only Workbench.
