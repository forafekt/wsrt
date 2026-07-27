# @wsrt/persistence-filesystem

> This package is part of WSRT, which is under active early development.

The default Node.js persistence provider. It uses atomic structured writes, bounded
NDJSON journals, private permissions, and a conservative single-writer workspace lock.

Remote-host lock owners are treated as live because their PID cannot be checked safely.

The provider stores data beneath the workspace `.wsrt/` directory and does not edit
project configuration or source files. Add `.wsrt/` to version control ignores. Use
`persistence: false` for ephemeral operation or `@wsrt/persistence-memory` in tests.

Filesystem persistence is local and single-writer; it is not a distributed lock or a
database durability guarantee.
