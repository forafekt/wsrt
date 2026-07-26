import { createWorkerPool } from "../dist/index.js";

const pool = createWorkerPool({
	worker: new URL("./transferable-worker.mjs", import.meta.url),
	minWorkers: 1,
	maxWorkers: 2,
});

await pool.ready();

const buffer = new ArrayBuffer(4);

new Uint8Array(buffer).set([1, 2, 3, 4]);

const sum = await pool.run("sumBuffer", buffer, { transferList: [buffer] });

console.log(sum);

await pool.shutdown("graceful");
