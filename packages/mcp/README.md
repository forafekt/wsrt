# @wsrt/mcp

> [!WARNING]
> This package is part of WSRT, which is under active early development. APIs, configuration, behavior, and package boundaries may change without notice. It is not currently recommended for production or critical workloads.

`WsrtMcpServer` exposes the control-plane tools and configured plugin tools,
resources, and prompts through the official MCP SDK transport interface.

```ts
const server = new WsrtMcpServer(controlPlane, { allowMutations: false })
await server.connect(transport)
await server.close()
```

Transport-safe plugin names use `<sanitized-plugin-id>.<contribution-id>` while
the internal invocation retains the original plugin identity. Registrations are
deterministic. Every request gets a fresh cancellation controller combined with
the transport request signal. Client cancellation, disconnect, or server shutdown
aborts active work; shutdown is idempotent and rejects new calls. Mutating tools
are denied unless explicitly enabled.

Plugin failures remain isolated and are returned as structured MCP tool errors.
Resources serialize as JSON content, prompts retain valid MCP message results,
and tools provide text plus structured content where possible. The server owns
its transport connection but not the control plane or plugin session; callers
dispose those after closing MCP.
