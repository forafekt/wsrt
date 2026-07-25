import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
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

test("awaited termination kills descendants, is idempotent, and releases their listener", {
	skip: process.platform === "win32",
}, async (t) => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "wsrt-process-tree-"));
	const runtime = await new NodeRuntimeProvider().create();
	const details = path.join(root, "descendant.json");
	const descendant = path.join(root, "descendant.cjs");
	const parent = path.join(root, "parent.cjs");
	await fs.writeFile(
		descendant,
		'const net=require("node:net");const server=net.createServer();server.once("error",error=>process.send({error:error.code}));server.listen(0,"127.0.0.1",()=>process.send({port:server.address().port}));',
	);
	await fs.writeFile(
		parent,
		'const {spawn}=require("node:child_process");const fs=require("node:fs");const child=spawn(process.execPath,[process.argv[2]],{stdio:["ignore","ignore","ignore","ipc"]});child.once("message",message=>fs.writeFileSync(process.argv[3],JSON.stringify({pid:child.pid,...message})));child.once("error",error=>fs.writeFileSync(process.argv[3],JSON.stringify({error:String(error)})));setInterval(()=>{},1000);',
	);
	const handle = runtime.capabilities.require("spawn").spawn({
		command: "node",
		args: [parent, descendant, details],
		cwd: root,
		environment: {},
		terminationGraceMs: 100,
	});
	try {
		const { pid, port, error } = await waitForJson(details);
		if (error === "EPERM") {
			t.skip("sandbox does not permit TCP listeners");
			return;
		}
		assert.equal(await canConnect(port), true);
		assert.equal(handle.terminationState, "running");
		await Promise.all([handle.terminateTree(), handle.terminateTree()]);
		assert.equal(handle.running, false);
		assert.equal(handle.terminationState, "stopped");
		assert.equal(processExists(pid), false);
		const rebound = net.createServer();
		await new Promise((resolve, reject) => {
			rebound.once("error", reject);
			rebound.listen(port, "127.0.0.1", resolve);
		});
		await new Promise((resolve) => rebound.close(resolve));
	} finally {
		await runtime.dispose();
		await fs.rm(root, { recursive: true, force: true });
	}
});

async function waitForJson(file) {
	for (let attempt = 0; attempt < 500; attempt++) {
		try {
			return JSON.parse(await fs.readFile(file, "utf8"));
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}
	throw new Error(`Timed out waiting for ${file}`);
}

function canConnect(port) {
	return new Promise((resolve) => {
		const socket = net.createConnection({ host: "127.0.0.1", port });
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("error", () => resolve(false));
	});
}

function processExists(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
