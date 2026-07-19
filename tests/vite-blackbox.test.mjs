import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { createControlPlane } from "../packages/control-plane/dist/index.js";

async function listenerAvailable(t) {
	const probe = net.createServer();
	try {
		await new Promise((resolve, reject) =>
			probe.listen(0, "127.0.0.1", resolve).once("error", reject),
		);
		return true;
	} catch (cause) {
		if (["EPERM", "EACCES"].includes(cause.code)) {
			t.skip(`listener creation unavailable: ${cause.code} ${cause.message}`);
			return false;
		}
		throw cause;
	} finally {
		if (probe.listening) await new Promise((resolve) => probe.close(resolve));
	}
}

async function fixture() {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "wsrt-vite-blackbox-"));
	const vitePlugin = pathToFileURL(path.resolve("plugins/vite/dist/plugin.js")).href;
	const nativePlugin = pathToFileURL(path.resolve("plugins/vite/dist/vite.js")).href;
	await fs.writeFile(
		path.join(root, "index.html"),
		'<main id="app"></main><script type="module" src="/main.js"></script>',
	);
	await fs.writeFile(
		path.join(root, "main.js"),
		'document.querySelector("#app").textContent="WSRT"',
	);
	await fs.writeFile(
		path.join(root, "vite.config.mjs"),
		`import { wsrt } from ${JSON.stringify(nativePlugin)}; export default { plugins: [wsrt()], server: { host: "127.0.0.1", port: 0 }, build: { outDir: "dist" } };`,
	);
	await fs.writeFile(
		path.join(root, "wsrt.json"),
		JSON.stringify({
			schemaVersion: "1",
			name: "vite-blackbox",
			plugins: [{ provider: vitePlugin }],
			services: {
				web: {
					provider: {
						provider: "vite",
						options: { command: "dev", host: "127.0.0.1", port: 0 },
					},
				},
			},
			tasks: {
				build: {
					provider: {
						provider: "vite",
						options: { command: "build", args: ["--outDir", "dist"] },
					},
				},
			},
		}),
	);
	return root;
}

test("real Vite service reports its selected ephemeral port and cleans telemetry", async (t) => {
	if (!(await listenerAvailable(t))) return;
	const root = await fixture();
	const plane = await createControlPlane({ root, config: "wsrt.json" });
	try {
		await plane.start(["web"]);
		const event = plane.listEvents().find((item) => item.type === "provider.server.listening");
		assert.ok(event);
		assert.equal(event.payload.port > 0, true);
		assert.equal(plane.snapshot().nodes.find((item) => item.id === "service:web").state, "ready");
		await plane.stop(["web"]);
		assert.equal(plane.getNodeState("service:web"), "stopped");
	} finally {
		await plane.dispose();
		await fs.rm(root, { recursive: true, force: true });
	}
});

test("Vite startup cancellation cannot later publish readiness or success", async (t) => {
	if (!(await listenerAvailable(t))) return;
	const root = await fixture();
	const plane = await createControlPlane({ root, config: "wsrt.json" });
	let stage = "start";
	try {
		const starting = plane.start(["web"]);
		const outcome = starting.then(
			(value) => ({ completed: true, value }),
			(cause) => ({ completed: false, cause }),
		);
		let operation;
		for (let attempt = 0; attempt < 100; attempt++) {
			operation = plane.listOperations().find((item) => item.status === "running");
			if (operation) break;
			await new Promise((resolve) => setImmediate(resolve));
		}
		assert.ok(operation);
		stage = "cancel";
		assert.equal(plane.cancelOperation(operation.id), true);
		const cancelled = await outcome;
		stage = "outcome";
		assert.equal(cancelled.completed, true);
		assert.equal(cancelled.value.status, "cancelled");
		const terminal = plane.getOperation(operation.id);
		stage = "invariants";
		assert.equal(terminal.status, "cancelled");
		assert.equal(
			plane
				.listEvents()
				.filter(
					(item) => item.type === "node.readiness.succeeded" && item.correlationId === operation.id,
				).length,
			0,
		);
		const snapshot = plane.snapshot();
		assert.equal(JSON.parse(JSON.stringify(snapshot)).revision, snapshot.revision);
	} catch (cause) {
		throw new Error(`Vite cancellation fixture failed during ${stage}: ${String(cause)}`, {
			cause,
		});
	} finally {
		await plane.dispose().catch(() => {});
		await fs.rm(root, { recursive: true, force: true });
	}
});

test("real Vite builds publish hashed artifacts and detect unchanged output", async () => {
	const root = await fixture();
	const plane = await createControlPlane({ root, config: "wsrt.json" });
	try {
		await plane.runTask("build");
		const first = plane.listArtifacts();
		assert.ok(first.length > 0);
		assert.ok(first.every((item) => item.hash && item.status === "ready"));
		await plane.runTask("build");
		assert.ok(plane.listArtifacts().every((item) => item.status === "unchanged"));
	} finally {
		await plane.dispose();
		await fs.rm(root, { recursive: true, force: true });
	}
});

test("concurrent Vite preparations have isolated wrapper and telemetry ownership", async () => {
	const pluginModule = await import("../plugins/vite/dist/plugin.js");
	const plugin = pluginModule.default();
	const adapter = plugin.contributions.adapters[0];
	const prepared = await Promise.all(
		Array.from({ length: 8 }, () => adapter.prepare({ command: "build" })),
	);
	try {
		const states = prepared.map((item) => item.metadata.executionState);
		assert.equal(new Set(states.map((item) => item.executionId)).size, states.length);
		assert.equal(new Set(states.map((item) => item.telemetryFile)).size, states.length);
	} finally {
		await Promise.all(prepared.map((item) => item.dispose()));
	}
});
