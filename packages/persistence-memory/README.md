# @wsrt/persistence-memory

> This package is part of WSRT, which is under active early development.

Deterministic, inspectable in-memory persistence for tests and ephemeral runs.

Use `memoryPersistence()` when a control plane must not create `.wsrt/` state. Records
last only for the provider instance's lifetime, making this suitable for isolated
tests and short-lived programmatic sessions, not restart recovery.
