# WSRT execution telemetry protocol

WSRT execution providers may cross a process boundary through a bounded JSON
Lines stream. Version 1 envelopes contain:

```ts
{
  protocol: 'wsrt.execution-telemetry'
  version: 1
  sequence: number
  timestamp: string
  executionId: string
  nodeId?: string
  operationId?: string
  event: ExecutionTelemetryEvent
}
```

Sequence numbers are positive, monotonically increasing, and scoped to an
execution. Readers reject duplicate, out-of-order, differently attributed, or
unsupported-version records independently. Invalid records do not terminate the
stream, but diagnostic emission is bounded. Unknown event types are ignored;
senders that need forward-compatible data should use a namespaced `custom` event.
An incomplete final line remains buffered until completed and is discarded when
the reader closes.

The currently validated events are execution start, selected listening address,
readiness availability, diagnostic, artifact discovery, and namespaced custom
events. Ports must be integers from 0 through 65535. Artifact paths must be
relative and cannot contain parent traversal. Environments and secrets are never
part of an envelope.

## Compatibility

Adding an optional envelope field or a new event that old readers can ignore is
compatible. Changing attribution, sequencing, validation, or an existing event
shape is breaking and requires a new protocol version. A reader accepts only the
versions it implements; multiple versions may coexist in separate execution
directories.

## File transport and ownership

The Vite transport stores each execution beneath the private
`<system-temp>/wsrt/executions` root. Every execution has a random ID, a mode-0600
telemetry file, and an ownership manifest containing protocol, version, creator
PID, execution ID, and creation time. Directories are mode 0700 where supported.
Writers validate the manifest before appending. Records are limited to 64 KiB and
files to 8 MiB. Readers consume only newly appended bytes and hold no watcher or
open descriptor between polls.

Cleanup validates the manifest and execution ID before removing a directory.
Startup scans at most 100 owned entries. State younger than 24 hours or belonging
to a live PID is retained; malformed manifests are not deleted. PID liveness plus
the age threshold makes PID reuse conservative. Cleanup is idempotent after
success, failure, cancellation, process exit, and control-plane disposal.

## Lifecycle and races

A reader moves through `created`, `active`, `closing`, and `closed`. Cancellation
stops polling through the operation `AbortSignal`. A final bounded drain is used
only when the operation is not cancelled. Closed readers and control-plane
executions reject late telemetry. Readiness must complete while the process is
still running, and health observation begins only after that completion.

Plugin authors should exercise adapters through
`@wsrt/capabilities/testing`. Mandatory guarantees are stable identity,
deterministic command/argument normalization, cancellation propagation,
idempotent cleanup, failure attribution, and concurrent execution isolation.
Readiness, diagnostics, and artifact publication are optional capabilities, but
must follow the same telemetry and cancellation rules when implemented.

Listener-based fixtures should bind the real service directly to port `0` and
consume its reported port. A capability probe may skip only `EPERM` or `EACCES`,
and the skip reason must include the platform error. `EADDRINUSE` and application
failures remain test failures.
