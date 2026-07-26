import { createWorkerPool } from "../dist/index.js";

const pool = createWorkerPool({
	worker: new URL("./cpu-heavy-worker.mjs", import.meta.url),
	minWorkers: 1,
	maxWorkers: 2,
});

await pool.ready();

const controller = new AbortController();

setTimeout(() => controller.abort(), 25);

try {
	await pool.run(
		"heavyCpuTask",
		{ iterations: 500_000_000 },
		{ signal: controller.signal, timeoutMs: 1_000 },
	);
} finally {
	await pool.shutdown("force");
}
