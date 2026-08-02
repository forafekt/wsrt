# Workspace revision contract

`workspaceRevision` is a monotonic, session-scoped version of the authoritative loaded
workspace model and live control-plane state.

- Revision `0` is the valid initial snapshot of every new session.
- Read operations do not change the revision.
- Accepted runtime mutations (operations, lifecycle state, health, diagnostics, and artifacts)
  increment it before publishing the new snapshot.
- All clients connected to one session observe the same current revision.
- `expectedRevision` rejects a request with `workspace.revision_stale` when it differs from the
  current revision.
- Workspace-intelligence caches and ownership indexes are keyed by revision and rebuilt after a
  revision change.
- Configuration/plugin changes are not hot-applied. The running session reports configuration
  drift as stale; restarting loads the new intelligence model into a new session at revision `0`.
  Consumers must use the session identity together with the revision and must not compare revision
numbers across sessions.

The response-quality corrections ship as workspace protocol version 2 and workspace-intelligence
schema version 2. Version 1 clients must migrate evidence arrays, provenance, and command-plan field
names together rather than mixing response generations.

This makes `0` informative rather than exceptional: repeated `0` values mean that the captured
commands were reads against the same unchanged initial session snapshot.
