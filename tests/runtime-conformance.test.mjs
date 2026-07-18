import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createControlPlane } from "../packages/control-plane/dist/index.js";
import { NodeRuntimeProvider } from "../runtimes/node/dist/index.js";
import {
	RustRuntimeClient,
	RustRuntimeProvider,
	resolveRustRuntimeBinary,
} from "../runtimes/rust/dist/index.js";

const providers = [
	["node", () => new NodeRuntimeProvider()],
	["rust", () => new RustRuntimeProvider()],
];

for (const [name, createProvider] of providers) {
	test(`${name} runtime conforms to the shared capability contract`, async () => {
		const runtime = await createProvider().create();
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), `wsrt-${name}-`));
		try {
			for (const capability of [
				"filesystem",
				"environment",
				"process",
				"http",
				"network",
				"timers",
				"logger",
				"spawn",
			])
				assert.equal(runtime.capabilities.has(capability), true, capability);
			const filesystem = runtime.capabilities.require("filesystem");
			const file = path.join(directory, "value.txt");
			await filesystem.writeText(file, "parity");
			assert.equal(await filesystem.readText(file), "parity");
			assert.equal(await filesystem.exists(file), true);
			assert.equal(
				runtime.capabilities.require("environment").get("PATH"),
				process.env.PATH,
			);
			assert.equal(
				runtime.capabilities.require("process").cwd(),
				process.cwd(),
			);

			const successful = runtime.capabilities.require("spawn").spawn({
				command: process.execPath,
				args: [
					"-e",
					"process.exit(process.argv[1] === 'forwarded' && process.cwd() === process.argv[2] && process.env.WSRT_CONFORMANCE === 'yes' ? 0 : 9)",
					"forwarded",
					directory,
				],
				cwd: directory,
				environment: { WSRT_CONFORMANCE: "yes" },
			});
			assert.equal((await successful.exit).code, 0);
			const failed = runtime.capabilities.require("spawn").spawn({
				command: process.execPath,
				args: ["-e", "process.exit(7)"],
				cwd: directory,
				environment: {},
			});
			assert.equal((await failed.exit).code, 7);
			const missing = runtime.capabilities.require("spawn").spawn({
				command: path.join(directory, "command-that-does-not-exist"),
				args: [],
				cwd: directory,
				environment: {},
			});
			assert.deepEqual(await missing.exit, {
				code: null,
				signal: "SPAWN_ERROR",
			});
			const concurrent = Array.from({ length: 4 }, (_, code) =>
				runtime.capabilities.require("spawn").spawn({
					command: process.execPath,
					args: ["-e", `process.exit(${code})`],
					cwd: directory,
					environment: {},
				}),
			);
			assert.deepEqual(
				(await Promise.all(concurrent.map((handle) => handle.exit))).map(
					(exit) => exit.code,
				),
				[0, 1, 2, 3],
			);

			const cancelled = runtime.capabilities.require("spawn").spawn({
				command: process.execPath,
				args: ["-e", "setInterval(() => {}, 1000)"],
				cwd: directory,
				environment: {},
			});
			cancelled.terminate();
			const cancelledExit = await Promise.race([
				cancelled.exit,
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error("termination timed out")), 5000),
				),
			]);
			assert.equal(cancelled.running, false);
			assert.equal(cancelledExit.code, null);

			const controller = new AbortController();
			const delayed = runtime.capabilities
				.require("timers")
				.delay(10_000, controller.signal);
			controller.abort(new Error("cancelled"));
			await assert.rejects(delayed, /cancelled/);

			const server = net.createServer();
			await new Promise((resolve, reject) =>
				server.listen(0, "127.0.0.1", resolve).once("error", reject),
			);
			const address = server.address();
			await runtime.capabilities
				.require("network")
				.connect("127.0.0.1", address.port, { timeoutMs: 1000 });
			await new Promise((resolve) => server.close(resolve));
		} finally {
			await runtime.dispose();
			await fs.rm(directory, { recursive: true, force: true });
		}
	});
}

test("Rust client rejects pending work when the native runtime crashes", async () => {
	const client = new RustRuntimeClient({ binary: resolveRustRuntimeBinary() });
	await client.start();
	const pending = client.request("connect", {
		host: "192.0.2.1",
		port: 9,
		timeoutMs: 30_000,
	});
	assert.equal(client.forceStop(), true);
	await assert.rejects(
		pending,
		/Rust runtime exited|ECONNREFUSED|operation failed/i,
	);
});

test("control plane runs a real ready and healthy graph through the Rust provider", async () => {
	const directory = await fs.mkdtemp(
		path.join(os.tmpdir(), "wsrt-rust-graph-"),
	);
	const probe = net.createServer();
	await new Promise((resolve, reject) =>
		probe.listen(0, "127.0.0.1", resolve).once("error", reject),
	);
	const port = probe.address().port;
	await new Promise((resolve) => probe.close(resolve));
	const server = path.join(directory, "server.mjs");
	await fs.writeFile(
		server,
		`import net from "node:net"; const server=net.createServer(); server.listen(${port}, "127.0.0.1"); process.on("SIGTERM",()=>server.close(()=>process.exit(0)));`,
	);
	await fs.writeFile(
		path.join(directory, "wsrt.json"),
		JSON.stringify({
			schemaVersion: "1",
			name: "rust-conformance",
			runtimes: { rust: { provider: "rust" } },
			services: {
				native: {
					runtime: "rust",
					command: { command: process.execPath, args: [server] },
					healthcheck: {
						type: "tcp",
						host: "127.0.0.1",
						port,
						retries: 20,
						intervalMs: 25,
						timeoutMs: 250,
					},
				},
			},
		}),
	);
	const plane = await createControlPlane({
		root: directory,
		config: "wsrt.json",
		providers: [new NodeRuntimeProvider(), new RustRuntimeProvider()],
	});
	try {
		const result = await plane.start(["native"]);
		assert.equal(result.states["service:native"], "ready");
		for (
			let attempt = 0;
			attempt < 20 && plane.snapshot().nodes[0].health !== "healthy";
			attempt++
		)
			await new Promise((resolve) => setTimeout(resolve, 25));
		assert.equal(plane.snapshot().nodes[0].health, "healthy");
		await plane.stop(["native"]);
		assert.equal(plane.getNodeState("service:native"), "stopped");
	} finally {
		await plane.dispose();
		await fs.rm(directory, { recursive: true, force: true });
	}
});
