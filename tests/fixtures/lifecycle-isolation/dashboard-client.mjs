import { parentPort, workerData } from "node:worker_threads";

const startedAt = performance.now();

const response = await fetch(
	`${workerData.url}api/nodes/${encodeURIComponent("service:server")}/start`,
	{ method: "POST" },
);

const accepted = await response.json();

const acknowledgementMs = performance.now() - startedAt;

const latencies = [];

for (let attempt = 0; attempt < 5; attempt++) {
	const before = performance.now();
	const snapshot = await fetch(`${workerData.url}api/snapshot`);
	if (!snapshot.ok) throw new Error(`Snapshot request failed: ${snapshot.status}`);
	latencies.push(performance.now() - before);
	await new Promise((resolve) => setTimeout(resolve, 50));
}

parentPort.postMessage({ accepted, acknowledgementMs, latencies });
