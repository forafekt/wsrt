import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { createControlPlane } from "@wsrt/control-plane";
import { startDashboard } from "@wsrt/plugin-dashboard";
import { NodeRuntimeProvider } from "../runtimes/node/dist/index.js";

const fixture = path.resolve("tests/fixtures/lifecycle-isolation/parent.mjs");

const dashboardClient = path.resolve("tests/fixtures/lifecycle-isolation/dashboard-client.mjs");

test("dashboard transport stays responsive and stop releases the owned process tree", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "wsrt-dashboard-isolation-"));
	const port = await availablePort();
	const pids = path.join(root, "pids.json");
	await fs.writeFile(
		path.join(root, "wsrt.json"),
		JSON.stringify({
			schemaVersion: "1",
			name: "dashboard-isolation",
			runtimes: { blocking: { provider: "blocking" } },
			services: {
				server: {
					runtime: "blocking",
					command: { command: process.execPath, args: [fixture] },
					environment: { WSRT_TEST_PORT: String(port), WSRT_TEST_PIDS: pids },
					healthcheck: { type: "tcp", host: "127.0.0.1", port },
					restart: { policy: "always", delayMs: 10 },
				},
			},
		}),
	);
	const provider = new BlockingNodeProvider(2000);
	const plane = await createControlPlane({
		root,
		config: "wsrt.json",
		providers: [new NodeRuntimeProvider(), provider],
		persistence: false,
	});
	const dashboard = await startDashboard(plane, { port: 0, strictPort: false, basePath: "/" });
	try {
		const { accepted, acknowledgementMs, latencies } = await runDashboardClient(dashboard.url);
		assert.ok(accepted.operationId);
		assert.ok(acknowledgementMs < 750, `operation acknowledgement took ${acknowledgementMs}ms`);
		assert.ok(Math.max(...latencies) < 500, `dashboard blocked for ${Math.max(...latencies)}ms`);

		const observed = await waitForJson(pids);
		assert.equal(processAlive(observed.parentPid), true);
		assert.equal(processAlive(observed.descendantPid), true);
		assert.equal(await connects(port), true);
		await waitForOperation(plane, accepted.operationId, "completed");

		const stopped = await fetch(
			`${dashboard.url}api/nodes/${encodeURIComponent("service:server")}/stop`,
			{ method: "POST" },
		);
		assert.equal(stopped.status, 202);
		const stopOperation = await stopped.json();
		await waitForOperation(plane, stopOperation.operationId, "completed");
		assert.equal(processAlive(observed.parentPid), false);
		assert.equal(processAlive(observed.descendantPid), false);
		await rebind(port);
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.equal(plane.snapshot().nodes[0].restartPending, false);
	} finally {
		await dashboard.close();
		await plane.dispose();
		await fs.rm(root, { recursive: true, force: true });
	}
});

class BlockingNodeProvider {
	id = "blocking";
	constructor(milliseconds) {
		this.milliseconds = milliseconds;
		this.delegate = new NodeRuntimeProvider();
	}
	async detect() {
		return { available: true };
	}
	async create() {
		const runtime = await this.delegate.create();
		const spawn = runtime.capabilities.require("spawn");
		runtime.capabilities.provide("spawn", {
			spawn: (request) => {
				const until = performance.now() + this.milliseconds;
				while (performance.now() < until) {}
				return spawn.spawn(request);
			},
		});
		return runtime;
	}
}

async function availablePort() {
	const server = net.createServer();
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const { port } = server.address();
	await new Promise((resolve) => server.close(resolve));
	return port;
}

function runDashboardClient(url) {
	return new Promise((resolve, reject) => {
		const worker = new Worker(dashboardClient, { workerData: { url } });
		worker.once("message", resolve);
		worker.once("error", reject);
		worker.once("exit", (code) => {
			if (code !== 0) reject(new Error(`Dashboard client worker exited with code ${code}`));
		});
	});
}

async function waitForJson(file) {
	for (let attempt = 0; attempt < 500; attempt++) {
		try {
			return JSON.parse(await fs.readFile(file, "utf8"));
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}
	throw new Error("PID fixture did not start");
}

async function waitForOperation(plane, id, status) {
	for (let attempt = 0; attempt < 500; attempt++) {
		if (plane.getOperation(id)?.status === status) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(
		`Operation ${id} did not reach ${status}: ${JSON.stringify({ operation: plane.getOperation(id), events: plane.listEvents().slice(-12) })}`,
	);
}

function processAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function connects(port) {
	return new Promise((resolve) => {
		const socket = net.createConnection({ host: "127.0.0.1", port });
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("error", () => resolve(false));
	});
}

async function rebind(port) {
	const server = net.createServer();
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", resolve);
	});
	await new Promise((resolve) => server.close(resolve));
}
