import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	connectOrStartWorkspaceSession,
	encodeFrame,
	LengthPrefixedFrameDecoder,
	readSessionRecord,
	sessionPaths,
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
