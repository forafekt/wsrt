import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NodeRuntimeProvider } from "../runtimes/node/dist/index.js";

test("Node supervision resolves node, propagates environment, and reports rapid failures", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "wsrt-process-"));
	const runtime = await new NodeRuntimeProvider().create();
	try {
		const successful = runtime.capabilities.require("spawn").spawn({
			command: "node",
			args: ["-e", "process.exit(process.env.WSRT_VALUE === 'ok' ? 0 : 9)"],
			cwd: root,
			environment: { WSRT_VALUE: "ok" },
		});
		assert.equal((await successful.exit).code, 0);
		const missingCwd = runtime.capabilities.require("spawn").spawn({
			command: "node",
			args: ["-e", "process.exit(0)"],
			cwd: path.join(root, "missing"),
			environment: {},
		});
		assert.deepEqual(await missingCwd.exit, {
			code: null,
			signal: "SPAWN_ERROR",
		});
	} finally {
		await runtime.dispose();
		await fs.rm(root, { recursive: true, force: true });
	}
});

test("Node runtime escalates ignored graceful shutdown and leaves no active handle", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "wsrt-process-force-"));
	const runtime = await new NodeRuntimeProvider().create();
	const ready = path.join(root, "ready");
	const handle = runtime.capabilities.require("spawn").spawn({
		command: "node",
		args: [
			"-e",
			"require('node:fs').writeFileSync(process.argv[1], 'ready'); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)",
			ready,
		],
		cwd: root,
		environment: {},
	});
	try {
		for (let attempt = 0; attempt < 500; attempt++) {
			try {
				await fs.access(ready);
				break;
			} catch {
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		}
		await fs.access(ready);
		await runtime.dispose();
		const exit = await handle.exit;
		assert.equal(handle.running, false);
		assert.equal(exit.signal, "SIGKILL");
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

test("timer cancellation before scheduling is immediate and listener-safe", async () => {
	const runtime = await new NodeRuntimeProvider().create();
	try {
		const controller = new AbortController();
		controller.abort(new Error("already cancelled"));
		await assert.rejects(
			runtime.capabilities.require("timers").delay(60_000, controller.signal),
			/already cancelled/,
		);
	} finally {
		await runtime.dispose();
	}
});
