import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createControlPlane, serializeControlPlaneError } from "@wsrt/control-plane";
import {
	createDashboardServer,
	createDirectDashboardBackend,
	createWorkerDashboardBackend,
	DashboardTransportError,
} from "@wsrt/plugin-dashboard";

test("direct and worker dashboard backends preserve commands, results, and domain errors", async () => {
	const root = await fixture();
	const plane = await createControlPlane({ root, persistence: false });
	const direct = await createDirectDashboardBackend(plane);
	const remote = createRemoteBackend(direct);
	try {
		const directAck = await direct.submit({ type: "node.start", nodeIds: ["application:desktop"] });
		await waitForOperation(plane, directAck.operationId);
		await plane.stop(["application:desktop"]);
		const remoteAck = await remote.backend.submit({
			type: "node.start",
			nodeIds: ["application:desktop"],
		});
		assert.deepEqual(Object.keys(remoteAck).sort(), Object.keys(directAck).sort());
		assert.deepEqual(remote.requests.at(-1), {
			type: "operation.submit",
			command: { type: "node.start", nodeIds: ["application:desktop"] },
		});

		const directError = await capturedError(() =>
			direct.submit({ type: "task.run", taskId: "application:desktop" }),
		);
		const remoteError = await capturedError(() =>
			remote.backend.submit({ type: "task.run", taskId: "application:desktop" }),
		);
		assert.equal(remoteError.code, directError.code);
		assert.deepEqual(remoteError.details, directError.details);

		const cancelled = await remote.backend.cancel({
			type: "operation.cancel",
			operationId: "missing",
		});
		assert.deepEqual(cancelled, { operationId: "missing", cancelled: false });
	} finally {
		await plane.dispose();
		await fs.rm(root, { recursive: true, force: true });
	}
});

test("worker subscriptions are monotonic and dispose exactly once", () => {
	const snapshot = dashboardSnapshot(1);
	let listener;
	let disposals = 0;
	const backend = createWorkerDashboardBackend({
		snapshot: () => snapshot,
		subscribe(next) {
			listener = next;
			next(snapshot);
			return () => disposals++;
		},
		request: async () => {
			throw new Error("unused");
		},
	});
	const revisions = [];
	const dispose = backend.subscribe((value) => revisions.push(value.revision));
	listener(dashboardSnapshot(3));
	listener(dashboardSnapshot(2));
	listener(dashboardSnapshot(3));
	assert.deepEqual(revisions, [1, 3]);
	dispose();
	assert.equal(disposals, 1);
});

test("worker transport failures remain distinct from control-plane domain errors", async () => {
	const backend = createWorkerDashboardBackend({
		snapshot: () => dashboardSnapshot(1),
		subscribe: () => () => undefined,
		request: async () => {
			throw new Error("port closed");
		},
	});
	await assert.rejects(
		backend.submit({ type: "task.run", taskId: "task:build" }),
		(cause) =>
			cause instanceof DashboardTransportError && cause.code === "dashboard.transport_failed",
	);
});

test("dashboard server shutdown disposes its backend subscriptions", async () => {
	const listeners = new Set();
	const snapshot = dashboardSnapshot(1);
	const backend = {
		snapshot: () => snapshot,
		subscribe(listener) {
			listeners.add(listener);
			listener(snapshot);
			return () => listeners.delete(listener);
		},
		async submit() {
			throw new Error("unused");
		},
		async cancel() {
			throw new Error("unused");
		},
		async runContribution() {
			throw new Error("unused");
		},
	};
	const dashboard = await createDashboardServer(backend, {
		port: 0,
		strictPort: false,
		basePath: "/",
	});
	const controller = new AbortController();
	const stream = fetch(`${dashboard.url}api/stream`, { signal: controller.signal }).catch(() => {});
	for (let attempt = 0; attempt < 100 && listeners.size === 0; attempt++)
		await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(listeners.size, 1);
	await dashboard.close();
	assert.equal(listeners.size, 0);
	controller.abort();
	await stream;
});

function createRemoteBackend(direct) {
	const requests = [];
	return {
		requests,
		backend: createWorkerDashboardBackend({
			snapshot: () => direct.snapshot(),
			subscribe: (listener) => direct.subscribe(listener),
			async request(request) {
				requests.push(request);
				try {
					if (request.type === "operation.submit")
						return {
							type: "success",
							response: {
								type: "operation.submitted",
								acknowledgement: await direct.submit(request.command),
							},
						};
					if (request.type === "operation.cancel")
						return {
							type: "success",
							response: {
								type: "operation.cancelled",
								result: await direct.cancel(request.command),
							},
						};
					return {
						type: "success",
						response: {
							type: "contribution.completed",
							value: await direct.runContribution(request.contributionId),
						},
					};
				} catch (cause) {
					return { type: "domain-error", error: serializeControlPlaneError(cause) };
				}
			},
		}),
	};
}

async function fixture() {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "wsrt-dashboard-backend-"));
	await fs.writeFile(
		path.join(root, "wsrt.json"),
		JSON.stringify({ name: "backend", applications: { desktop: {} }, tasks: { build: {} } }),
	);
	return root;
}

async function waitForOperation(plane, id) {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (plane.getOperation(id)?.status === "completed") return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error(`Operation ${id} did not complete`);
}

async function capturedError(run) {
	try {
		await run();
	} catch (cause) {
		return cause;
	}
	throw new Error("Expected operation to fail");
}

function dashboardSnapshot(revision) {
	return {
		protocolVersion: 3,
		protocol: { transport: 1, snapshot: 3, contributions: 1, actions: 1, events: 1 },
		revision,
		controlPlane: {
			revision,
			generatedAt: new Date().toISOString(),
			workspace: { name: "test", root: "/test" },
			nodes: [],
			operations: [],
			artifacts: [],
			diagnostics: [],
			events: { size: 0 },
			plugins: [],
			providers: [],
		},
		graph: { nodes: [], edges: [] },
		events: [],
		configuration: {},
		contributions: [],
	};
}
