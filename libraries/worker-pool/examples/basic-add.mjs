import { createWorkerPool } from "../dist/index.js";

const pool = createWorkerPool({
	worker: new URL("./basic-worker.mjs", import.meta.url),
	minWorkers: 1,
	maxWorkers: 4,
});

await pool.ready();

console.log(await pool.run("add", { a: 1, b: 2 }));

await pool.shutdown("graceful");
