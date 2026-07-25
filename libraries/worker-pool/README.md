# @wsrt/worker-pool

Typed Node.js `worker_threads` pool for CPU-heavy and isolation-sensitive work.

The package is ESM-first, dependency-free at runtime, and designed for reusable production code rather than examples-only usage. It supports fixed and dynamic worker counts, bounded queues, priorities, retries, cancellation, timeouts, metrics, and structured lifecycle events.

## Usage

```ts
import { createWorkerPool } from '@wsrt/worker-pool'

type Tasks = {
  add: {
    input: { a: number; b: number }
    output: number
  }
  hashFile: {
    input: { path: string }
    output: string
  }
}

const pool = createWorkerPool<Tasks>({
  worker: new URL('./worker.js', import.meta.url),
  minWorkers: 2,
  maxWorkers: 8,
  maxQueueSize: 10_000,
})

await pool.ready()

const result = await pool.run(
  'add',
  { a: 1, b: 2 },
  {
    timeoutMs: 30_000,
    priority: 10,
  },
)

await pool.shutdown('graceful')
```

Worker module:

```ts
import { defineWorkerTasks } from '@wsrt/worker-pool/worker'

defineWorkerTasks({
  add(input: { a: number; b: number }) {
    return input.a + input.b
  },

  heavyCpuTask(input: { iterations: number }, context) {
    let total = 0
    for (let index = 0; index < input.iterations; index += 1) {
      if (index % 10_000 === 0) context.throwIfAborted()
      total += index
    }
    return total
  },
})
```

## Options

`createWorkerPool(options)` accepts:

- `worker`: `URL | string` passed to `new Worker()`.
- `workers`: fixed worker count. When set, it overrides `minWorkers` and `maxWorkers`.
- `minWorkers`: warm workers created immediately. Defaults to `1`.
- `maxWorkers`: maximum dynamic workers. Defaults to `availableParallelism() - 1`.
- `maxQueueSize`: maximum queued jobs. Defaults to unbounded.
- `queueFullPolicy`: `reject`, `drop-oldest`, or `drop-newest`. Defaults to `reject`.
- `defaultTimeoutMs`: default timeout for all jobs.
- `heartbeatIntervalMs`: health-check interval. Defaults to `1000`.
- `heartbeatTimeoutMs`: restart threshold for unhealthy workers.
- `taskDefaults`: per-task defaults for `timeoutMs`, retry settings, `priority`, and `concurrency`.
- `logger`: structured logger hook with `debug`, `info`, `warn`, and `error` methods.

## Job Options

`pool.run(taskName, payload, options)` accepts:

- `timeoutMs`: timeout for the attempt.
- `priority`: higher numbers run before lower-priority queued jobs.
- `signal`: `AbortSignal` for queued or running cancellation.
- `transferList`: transferable objects passed to `worker.postMessage()`.
- `retries`: number of retries after the first failed attempt.
- `delayMs`: retry delay.
- `exponentialBackoff`: doubles retry delay per attempt.
- `maxDelayMs`: cap for exponential backoff.

## Events

The pool is a typed event emitter:

- `job:queued`
- `job:started`
- `job:completed`
- `job:failed`
- `job:cancelled`
- `job:timeout`
- `worker:spawned`
- `worker:ready`
- `worker:exit`
- `worker:error`
- `worker:restarted`
- `pool:drained`
- `pool:closed`

Each job event includes a job snapshot. Worker events include a worker snapshot.

## Metrics

`pool.metrics()` returns:

- `queueSize`
- `activeWorkers`
- `idleWorkers`
- `completedJobs`
- `failedJobs`
- `cancelledJobs`
- `timedOutJobs`
- `retriedJobs`
- `workerRestarts`
- `averageWaitMs`
- `averageRunMs`

## Shutdown

- `graceful`: stop accepting new jobs, let queued and running jobs finish, then close workers.
- `drain`: same drain behavior, intended for callers that want to make the drain semantics explicit.
- `force`: cancel queued work and terminate workers immediately.

After shutdown starts, new calls to `run()` reject with `WorkerPoolClosedError`.

## Cancellation and Timeouts

Queued jobs are cancelled before they start. Running jobs receive a worker-side abort signal, then the pool settles the promise and recycles the worker. JavaScript cannot forcibly interrupt arbitrary synchronous worker code without terminating the worker, so task code should call `context.throwIfAborted()` in long loops and check `context.signal` around async boundaries.

Timeouts settle the job with `JobTimeoutError` and recycle the worker. Worker crashes and heartbeat failures also recycle workers and keep the pool at `minWorkers`.

## Errors

Worker errors are serialized in the worker and reconstructed in the parent process with `name`, `message`, `stack`, `code`, and nested `cause` where available. Queue, timeout, cancellation, and closed-pool failures use package error classes.

## Development

From the monorepo root:

```sh
/home/$USER/.nvm/versions/node/v23.3.0/bin/pnpm --filter @wsrt/worker-pool build
/home/$USER/.nvm/versions/node/v23.3.0/bin/pnpm --filter @wsrt/worker-pool test
```

## Examples

Build the package first, then run examples from the package directory:

```sh
/home/$USER/.nvm/versions/node/v23.3.0/bin/node node_modules/typescript/lib/tsc.js -p packages/al-framework/worker-pool/tsconfig.build.json
cd packages/al-framework/worker-pool
/home/$USER/.nvm/versions/node/v23.3.0/bin/node examples/node-server.mjs
```

`examples/node-server.mjs` starts a separate HTTP server inside a worker thread using `examples/node-server-worker.mjs`. The parent process controls that server through pool tasks, while the worker owns the server lifecycle.

## Production Notes

- Keep workers pure and explicitly pass inputs. Avoid sharing mutable process state.
- Use `maxQueueSize` for backpressure in services.
- Set task-level `concurrency` for tasks that consume scarce external resources.
- Prefer transferable buffers for large binary payloads.
- Treat worker modules as trusted code. Worker threads are isolation for concurrency and failure containment, not a security sandbox.
