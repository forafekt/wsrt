import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	connectOrStartWorkspaceSession,
	encodeFrame,
	LengthPrefixedFrameDecoder,
	readSessionRecord,
	sessionPaths,
	validateRecordedSession,
	WorkspaceConfigurationTracker,
	WorkspaceLeaseRegistry,
	workspaceIdentity,
} from "../packages/workspace-session/dist/index.js";

test("workspace identity canonicalizes symlink and relative forms", async () => {
	const parent = await fs.mkdtemp(path.join(os.tmpdir(), "wsrt-identity-"));
	const root = path.join(parent, "workspace");
	await fs.mkdir(root);
	await fs.symlink(root, path.join(parent, "alias"));
	try {
		assert.deepEqual(
			await workspaceIdentity(root),
			await workspaceIdentity(path.join(parent, "alias", ".")),
		);
	} finally {
		await fs.rm(parent, { recursive: true, force: true });
	}
});

test("length-prefixed framing handles partial and coalesced frames and rejects oversized input", () => {
	const first = encodeFrame({ value: 1 });
	const second = encodeFrame({ value: 2 });
	const decoder = new LengthPrefixedFrameDecoder();
	assert.deepEqual(decoder.push(first.subarray(0, 3)), []);
	const decoded = decoder
		.push(Buffer.concat([first.subarray(3), second]))
		.map((value) => JSON.parse(value));
	assert.deepEqual(decoded, [{ value: 1 }, { value: 2 }]);
	const invalid = Buffer.alloc(4);
	invalid.writeUInt32BE(9 * 1024 * 1024);
	assert.throws(() => decoder.push(invalid), /exceeds/);
});

test("concurrent clients elect one authoritative host", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "wsrt-session-"));
	await fs.writeFile(
		path.join(root, "wsrt.json"),
		JSON.stringify({ schemaVersion: "1", name: "session", applications: { desktop: {} } }),
	);
	let clients = [];
	try {
		clients = await Promise.all(
			Array.from({ length: 4 }, () => connectOrStartWorkspaceSession({ root })),
		);
		assert.equal(new Set(clients.map((client) => client.session.sessionId)).size, 1);
		assert.equal(new Set(clients.map((client) => client.session.pid)).size, 1);
		const identity = await workspaceIdentity(root);
		const record = await readSessionRecord(sessionPaths(root, identity.workspaceId).record);
		assert.equal(record?.sessionId, clients[0].session.sessionId);
		await clients[0].stopSession();
	} finally {
		await Promise.all(clients.map((client) => client.close().catch(() => {})));
		await fs.rm(root, { recursive: true, force: true });
	}
});

test("session validation distinguishes matching, reused, missing, and incompatible hosts", async () => {
	const record = {
		schemaVersion: 1,
		protocolVersion: 1,
		workspaceId: "workspace",
		workspaceRoot: "/workspace",
		sessionId: "session",
		pid: 42,
		processStartedAt: "linux:boot:10",
		endpoint: { kind: "unix", address: "/socket" },
		createdAt: new Date(0).toISOString(),
	};
	const handshake = {
		protocolVersion: 1,
		minimumClientProtocolVersion: 1,
		workspaceId: "workspace",
		workspaceRoot: "/workspace",
		sessionId: "session",
		pid: 42,
		processStartedAt: "linux:boot:10",
		hostVersion: "test",
		state: "ready",
	};
	const provider = (identity) => ({ current: async () => identity, inspect: async () => identity });
	assert.equal(
		(
			await validateRecordedSession(
				record,
				"workspace",
				provider({ pid: 42, startedAt: "linux:boot:10" }),
				async () => handshake,
			)
		).status,
		"healthy",
	);
	assert.deepEqual(
		await validateRecordedSession(
			record,
			"workspace",
			provider({ pid: 42, startedAt: "linux:boot:99" }),
			async () => handshake,
		),
		{ status: "stale", reason: "process-reused" },
	);
	assert.deepEqual(
		await validateRecordedSession(record, "workspace", provider(undefined), async () => handshake),
		{ status: "stale", reason: "process-missing" },
	);
	assert.deepEqual(
		await validateRecordedSession(
			record,
			"workspace",
			provider({ pid: 42, startedAt: "linux:boot:10" }),
			async () => ({ ...handshake, protocolVersion: 99 }),
		),
		{ status: "incompatible", reason: "protocol-version" },
	);
});

test("leases renew, release idempotently, and expire with an injected clock", () => {
	let now = 1_000;
	const leases = new WorkspaceLeaseRegistry({ now: () => now }, 100);
	const lease = leases.acquire("dashboard");
	assert.equal(leases.list().length, 1);
	now = 1_050;
	assert.ok(leases.renew(lease.id));
	now = 1_151;
	assert.equal(leases.list().length, 0);
	assert.equal(leases.release(lease.id), false);
});

test("configuration fingerprints include imported sources and report drift", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "wsrt-config-revision-"));
	const imported = path.join(root, "shared.ts");
	const entry = path.join(root, "wsrt.config.ts");
	await fs.writeFile(imported, "export const name = 'one';\n");
	await fs.writeFile(entry, "import { name } from './shared.js'; export default { name };\n");
	try {
		const tracker = await WorkspaceConfigurationTracker.create(entry, { name: "one" });
		assert.equal((await tracker.inspect({ name: "one" })).stale, false);
		await fs.writeFile(imported, "export const name = 'two';\n");
		const changed = await tracker.inspect({ name: "one" });
		assert.equal(changed.stale, true);
		assert.deepEqual(changed.changedSources, [imported]);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

test("dashboard actions execute in the host and support protocol cancellation", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "wsrt-session-actions-"));
	await fs.writeFile(path.join(root, "package.json"), '{"type":"module"}');
	await fs.writeFile(
		path.join(root, "plugin.mjs"),
		`export default { id: "actions", version: "1.0.0", contributions: { dashboard: [
			{ id: "record", kind: "action", title: "Record", run(input, context) { context.events.emit("fixture.action", input); return { recorded: input }; } },
			{ id: "wait", kind: "action", title: "Wait", run(_input, _context, signal) { return new Promise((resolve, reject) => { const timer = setTimeout(resolve, 10000); signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true }); }); } }
		] } };`,
	);
	await fs.writeFile(
		path.join(root, "wsrt.json"),
		JSON.stringify({ schemaVersion: "1", name: "actions", plugins: ["./plugin.mjs"] }),
	);
	const client = await connectOrStartWorkspaceSession({ root });
	try {
		const actions = await client.dashboardActions();
		assert.deepEqual(
			actions.map((item) => item.id),
			["actions/record", "actions/wait"],
		);
		assert.deepEqual(await client.invokeDashboardAction("actions/record", { value: 1 }), {
			recorded: { value: 1 },
		});
		assert.ok((await client.events()).some((event) => event.type === "fixture.action"));
		const controller = new AbortController();
		const waiting = client.invokeDashboardAction("actions/wait", undefined, controller.signal);
		controller.abort(new Error("cancel test"));
		await assert.rejects(waiting, /cancel test|cancelled/);
		const lease = await client.acquireLease("dashboard");
		assert.ok((await client.status()).leases.some((item) => item.id === lease.id));
		await client.releaseLease(lease.id);
	} finally {
		await client.stopSession().catch(() => {});
		await client.close().catch(() => {});
		await fs.rm(root, { recursive: true, force: true });
	}
});

test("orderly session shutdown terminates a real process tree and releases its port", {
	skip: process.platform === "win32",
}, async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "wsrt-session-shutdown-"));
	const port = await availablePort();
	const pids = path.join(root, "pids.json");
	await fs.writeFile(
		path.join(root, "wsrt.json"),
		JSON.stringify({
			schemaVersion: "1",
			name: "shutdown",
			services: {
				server: {
					command: {
						command: process.execPath,
						args: [path.resolve("tests/fixtures/lifecycle-isolation/parent.mjs")],
					},
					environment: { WSRT_TEST_PORT: String(port), WSRT_TEST_PIDS: pids },
					healthcheck: { type: "tcp", host: "127.0.0.1", port },
				},
			},
		}),
	);
	const client = await connectOrStartWorkspaceSession({ root });
	try {
		await client.execute({ type: "node.start", nodeIds: ["service:server"] });
		const observed = await waitForJson(pids);
		assert.equal(processAlive(observed.parentPid), true);
		assert.equal(processAlive(observed.descendantPid), true);
		await client.stopSession();
		assert.equal(processAlive(observed.parentPid), false);
		assert.equal(processAlive(observed.descendantPid), false);
		await rebind(port);
		const identity = await workspaceIdentity(root);
		const paths = sessionPaths(root, identity.workspaceId);
		await assert.rejects(fs.stat(paths.record));
		await assert.rejects(fs.stat(paths.endpoint.address));
		await assert.rejects(fs.stat(path.join(root, ".wsrt", "locks", "workspace.lock")));
	} finally {
		await client.close().catch(() => {});
		await fs.rm(root, { recursive: true, force: true });
	}
});

test("an unclean host crash elects one replacement with a new session identity", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "wsrt-session-crash-"));
	await fs.writeFile(
		path.join(root, "wsrt.json"),
		JSON.stringify({ schemaVersion: "1", name: "crash" }),
	);
	const first = await connectOrStartWorkspaceSession({ root });
	const oldSessionId = first.session.sessionId;
	try {
		process.kill(first.session.pid, "SIGKILL");
		await first.connection.closed;
		for (let attempt = 0; attempt < 500; attempt++) {
			if (
				!(await fs.stat(`/proc/${first.session.pid}`).then(
					() => true,
					() => false,
				))
			)
				break;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		const replacements = await Promise.all(
			Array.from({ length: 3 }, () => connectOrStartWorkspaceSession({ root })),
		);
		try {
			assert.equal(new Set(replacements.map((item) => item.session.sessionId)).size, 1);
			assert.notEqual(replacements[0].session.sessionId, oldSessionId);
			await assert.rejects(replacements[0].renewLease("old-session-lease"), /not active|not found/);
			await replacements[0].stopSession();
		} finally {
			await Promise.all(replacements.map((item) => item.close().catch(() => {})));
		}
	} finally {
		await first.close().catch(() => {});
		await fs.rm(root, { recursive: true, force: true });
	}
});

async function availablePort() {
	const server = net.createServer();
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const port = server.address().port;
	await new Promise((resolve) => server.close(resolve));
	return port;
}
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
function processAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
async function rebind(port) {
	const server = net.createServer();
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", resolve);
	});
	await new Promise((resolve) => server.close(resolve));
}
