import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createWorkerPool,
	JobCancelledError,
	JobTimeoutError,
	QueueFullError,
} from "../dist/index.js";

const worker = new URL("./fixtures/tasks.mjs", import.meta.url);

async function withPool(options, fn) {
	const pool = createWorkerPool({ worker, minWorkers: 1, maxWorkers: 1, ...options });
	await pool.ready();
	try {
		return await fn(pool);
	} finally {
		await pool.shutdown("force");
	}
}

test("executes a successful worker job", async () => {
	await withPool({}, async (pool) => {
		assert.equal(await pool.run("add", { a: 2, b: 3 }), 5);
	});
});

test("supports typed task maps at compile time through the public generic API", async () => {
	await withPool({}, async (pool) => {
		const result = await pool.run("echo", { value: "typed-example" });
		assert.deepEqual(result, { value: "typed-example" });
	});
});

test("times out a running job and replaces the worker", async () => {
	await withPool({ heartbeatTimeoutMs: 1_000 }, async (pool) => {
		await assert.rejects(
			pool.run("sleep", { ms: 100 }, { timeoutMs: 10 }),
			(error) => error instanceof JobTimeoutError,
		);
		assert.equal(await pool.run("add", { a: 1, b: 1 }), 2);
		assert.equal(pool.metrics().timedOutJobs, 1);
		assert.equal(pool.metrics().workerRestarts, 1);
	});
});

test("cancels a queued job before it starts", async () => {
	await withPool({}, async (pool) => {
		const blocker = pool.run("sleep", { ms: 80 });
		const controller = new AbortController();
		const queued = pool.run("add", { a: 1, b: 2 }, { signal: controller.signal });
		controller.abort();

		await assert.rejects(queued, (error) => error instanceof JobCancelledError);
		assert.equal(await blocker, 80);
		assert.equal(pool.metrics().cancelledJobs, 1);
	});
});

test("cancels a running job cooperatively and recycles the worker", async () => {
	await withPool({}, async (pool) => {
		const controller = new AbortController();
		const running = pool.run("sleep", { ms: 200 }, { signal: controller.signal });
		controller.abort();

		await assert.rejects(running, (error) => error instanceof JobCancelledError);
		assert.equal(await pool.run("add", { a: 4, b: 6 }), 10);
		assert.equal(pool.metrics().cancelledJobs, 1);
	});
});

test("replaces a worker after a crash without hanging subsequent jobs", async () => {
	await withPool({}, async (pool) => {
		await assert.rejects(pool.run("crash", {}), /Worker exited/);
		assert.equal(await pool.run("add", { a: 5, b: 7 }), 12);
		assert.equal(pool.metrics().workerRestarts, 1);
	});
});

test("retries failed jobs and eventually succeeds", async () => {
	await withPool({}, async (pool) => {
		assert.equal(await pool.run("failOnce", { key: "retry-success" }, { retries: 1 }), "ok");
		assert.equal(pool.metrics().retriedJobs, 1);
	});
});

test("reports retry exhaustion and reconstructs worker errors", async () => {
	await withPool({}, async (pool) => {
		await assert.rejects(pool.run("alwaysFail", {}, { retries: 1 }), (error) => {
			assert.equal(error.name, "Error");
			assert.equal(error.message, "expected failure");
			assert.equal(error.code, "EXPECTED");
			return true;
		});
		assert.equal(pool.metrics().failedJobs, 1);
		assert.equal(pool.metrics().retriedJobs, 1);
	});
});

test("rejects when maxQueueSize is reached", async () => {
	await withPool({ maxQueueSize: 1 }, async (pool) => {
		const blocker = pool.run("sleep", { ms: 80 });
		const queued = pool.run("sleep", { ms: 10 });
		await assert.rejects(pool.run("sleep", { ms: 10 }), (error) => error instanceof QueueFullError);
		await Promise.all([blocker, queued]);
	});
});

test("supports drop-oldest queue policy", async () => {
	await withPool({ maxQueueSize: 1, queueFullPolicy: "drop-oldest" }, async (pool) => {
		const blocker = pool.run("sleep", { ms: 80 });
		const oldest = pool.run("sleep", { ms: 10, value: "oldest" });
		const newest = pool.run("sleep", { ms: 10, value: "newest" });

		await assert.rejects(oldest, (error) => error instanceof JobCancelledError);
		assert.equal(await newest, "newest");
		await blocker;
	});
});

test("runs higher priority queued jobs first", async () => {
	await withPool({}, async (pool) => {
		const order = [];
		pool.on("job:completed", (_job, result) => {
			if (result === "low" || result === "high") order.push(result);
		});

		const blocker = pool.run("sleep", { ms: 80 });
		const low = pool.run("sleep", { ms: 1, value: "low" }, { priority: 0 });
		const high = pool.run("sleep", { ms: 1, value: "high" }, { priority: 10 });
		await Promise.all([blocker, low, high]);

		assert.deepEqual(order, ["high", "low"]);
	});
});

test("drains on graceful shutdown", async () => {
	const pool = createWorkerPool({ worker, minWorkers: 1, maxWorkers: 1 });
	await pool.ready();
	const result = pool.run("sleep", { ms: 20, value: "done" });
	await pool.shutdown("graceful");

	assert.equal(await result, "done");
	await assert.rejects(pool.run("add", { a: 1, b: 1 }));
});

test("force shutdown cancels queued jobs", async () => {
	const pool = createWorkerPool({ worker, minWorkers: 1, maxWorkers: 1 });
	await pool.ready();
	const running = pool.run("sleep", { ms: 100 });
	const queued = pool.run("sleep", { ms: 100 });
	const queuedCancelled = assert.rejects(queued, (error) => error instanceof JobCancelledError);
	const runningStopped = assert.rejects(running);

	await pool.shutdown("force");
	await queuedCancelled;
	await runningStopped;
});

test("updates metrics after completed work", async () => {
	await withPool({}, async (pool) => {
		await pool.run("add", { a: 10, b: 20 });
		const metrics = pool.metrics();
		assert.equal(metrics.completedJobs, 1);
		assert.equal(metrics.queueSize, 0);
		assert.equal(metrics.activeWorkers, 0);
		assert.equal(metrics.idleWorkers, 1);
		assert.ok(metrics.averageWaitMs >= 0);
		assert.ok(metrics.averageRunMs >= 0);
	});
});
