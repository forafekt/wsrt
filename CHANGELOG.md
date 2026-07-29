# Changelog

This file records released WSRT package-set versions. No releases have been published yet.

## Unreleased

- Implement `dependsOn.condition`. `started`, `ready`, `healthy`, `successful` and
  `completed` now gate dependant startup individually; previously the condition was
  parsed and validated but every dependency behaved the same. Startup scheduling is
  dependency-driven instead of stage-synchronised, unsatisfiable conditions are
  reported as configuration errors, and a dependant whose condition is not met is
  reported as `blocked`. An omitted condition normalizes to `ready`, which preserves
  the previously observable behaviour.

- Prepare the initial fixed-version npm package set.
- Add explicit exports, packed-tarball checks, external-consumer smoke coverage, and release documentation.
- Defer the Rust runtime from npm distribution until platform binaries are available.
