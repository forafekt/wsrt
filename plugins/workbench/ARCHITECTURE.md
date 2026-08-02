# Workbench architecture

The Workbench is an independent WSRT plugin and a client of the authoritative workspace host.
Its backend owns HTTP/SSE framing, static assets, bounded request bodies and session event fan-out;
it forwards typed protocol requests and does not scan files or derive ownership, impact, validation,
graph, runtime, or evidence state. The browser is a dependency-free TypeScript application split into
transport, state and presentation modules. Server state, navigation/query state, persisted layout and
pending mutations remain separate.

The dashboard was inspected for local-server and reconnect patterns but no code was extracted: the
Workbench's semantic query transport differs materially, and a shared package would currently be
premature. There is no import, dependency, registration, or shared ownership with the dashboard.
Routes are deep-linkable beneath the configured base path. Graph slices are bounded to 120 nodes and
depth three. Lists are paginated by the protocol and rendered in bounded windows. Tests cover options,
routes, presentation search, server lifecycle, and dashboard independence.
