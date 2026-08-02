# Ownership and impact architecture audit

This audit records the Step 1 findings for the ownership and impact milestone. It
precedes the implementation changes and defines the intended consolidation.

## Current sources and failure causes

- `NormalizedExecutable.files` in `@wsrt/config` is the canonical source of
  explicit roles. It contains normalized workspace-relative patterns and config
  provenance. Task inputs and outputs are normalized into the same collection.
- `WorkspaceNodeDescription.files` is currently the effective ownership record.
  `DefaultWorkspaceIntelligence.#node` combines explicit executable files with
  plugin facts every time a node is described. There is no revision-owned
  forward/reverse index.
- Associations store patterns only. Query results do not distinguish a declared
  pattern from an exact path produced by matching a query candidate.
- `queryFiles` calls the shared matcher with candidate/pattern semantics that are
  easy to reverse and performs no canonical workspace-path validation. Windows
  separators and escaping query paths are not normalized consistently.
- Project roots are workspace-relative in descriptions, executable roots are
  absolute in normalized configuration, and plugin patterns are independently
  prefixed. These are converted at different boundaries rather than by one path
  service.
- `contains` edges represent application/process composition, but file queries
  only inspect the requested node. Parent applications therefore do not expose
  process ownership.
- Plugin facts are selected and merged while rendering individual nodes. The
  capability check only examines explicit executable files, so plugin results
  can coexist with an unavailable capability.
- Change impact calls `queryFiles`; it consequently shares its matching gaps and
  then traverses only `depends-on` dependants. It does not traverse composition,
  task input/output, producer, or consumer relationships.
- CLI, MCP, and the session client are thin adapters over the protocol today;
  they do not contain competing ownership logic. The duplicated concepts are
  the weak node-local association shape and the plugin association shape.

These causes explain the ActiveLane observations: Vite facts could appear while
the capability was false; unresolved `vite.config.*` was presented like a file;
an exact config lookup could miss due to matching/path semantics; renderer facts
contained only Vite's generic HTML/config/output declarations; application
queries did not aggregate contained processes; and impact had no direct owner to
seed traversal.

## Canonical semantics and consolidation plan

1. A file association is immutable, JSON-safe, workspace-relative, and records
   its actual owner, owner kind, role, exact/glob match kind, generated status,
   contribution source, evidence, confidence, and optional project/producer/
   consumer identities.
2. Paths use forward slashes. Query paths are exact workspace-relative paths and
   reject absolute or escaping values. Patterns use the same coordinate system;
   project-relative declarations are resolved once during normalization.
3. The workspace-intelligence snapshot owns one revision-scoped association
   index assembled from normalized configuration and plugin contributions.
   Forward queries and reverse lookup use that index. Aggregation follows bounded,
   cycle-safe graph relationships while retaining the actual owner.
4. Support is `full`, `partial`, or `unavailable`: explicit normalized ownership
   provides full support; plugin-only knowledge is partial; neither is unavailable.
   Empty results always retain this support state and warnings where evidence is
   incomplete.
5. Impact and validation consume this same index and authoritative graph. Session,
   CLI, MCP, and SDK remain protocol adapters and must not implement matching or
   traversal themselves.

