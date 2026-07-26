import { createWorkerPool } from "../dist/index.js";

const pool = createWorkerPool({
	worker: new URL("./cpu-heavy-worker.mjs", import.meta.url),
	minWorkers: 2,
	maxWorkers: 8,
});

await pool.ready();

const result = await pool.run("heavyCpuTask", { iterations: 5_000_000 }, { timeoutMs: 30_000 });

console.log(result);

await pool.shutdown("graceful");
