import { createWorkerPool } from "../dist/index.js";

const pool = createWorkerPool({
	worker: new URL("./cpu-heavy-worker.mjs", import.meta.url),
	minWorkers: 1,
	maxWorkers: 6,
	maxQueueSize: 1_000,
});

await pool.ready();

const jobs = Array.from({ length: 20 }, () =>
	pool.run("heavyCpuTask", { iterations: 500_000 }, { priority: 1 }),
);

await Promise.all(jobs);

console.log(pool.metrics());

await pool.shutdown("graceful");
