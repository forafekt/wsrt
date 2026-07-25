# @wsrt/persistence-filesystem

The default Node.js persistence provider. It uses atomic structured writes, bounded
NDJSON journals, private permissions, and a conservative single-writer workspace lock.

Remote-host lock owners are treated as live because their PID cannot be checked safely.
