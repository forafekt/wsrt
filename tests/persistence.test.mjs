import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	createRecord,
	MigrationRegistry,
	pluginStorage,
	validatePersistenceKey,
} from "../packages/persistence/dist/index.js";
import { FilesystemPersistenceProvider } from "../packages/persistence-filesystem/dist/index.js";
import { MemoryPersistenceProvider } from "../packages/persistence-memory/dist/index.js";
import { createControlPlane } from "../packages/control-plane/dist/index.js";

test("memory persistence provides isolated values, journals, and plugin namespaces", async () => {
	const provider = new MemoryPersistenceProvider();
	await provider.initialize({ workspaceRoot: "/workspace" });
	await provider.write("snapshot/latest", { revision: 1 });
	assert.deepEqual((await provider.read("snapshot/latest"))?.value, { revision: 1 });
	await provider.append("journal/events", { sequence: 1 });
	await provider.append("journal/events", { sequence: 2 });
	assert.deepEqual(provider.journal("journal/events"), [{ sequence: 1 }, { sequence: 2 }]);

	const first = pluginStorage(provider, "first");
	const second = pluginStorage(provider, "second");
	await first.set("preferences/theme", "dark");
	await second.set("preferences/theme", "light");
	assert.equal(await first.get("preferences/theme"), "dark");
	assert.equal(await second.get("preferences/theme"), "light");
	assert.deepEqual(await first.list("preferences"), ["preferences/theme"]);
	await first.delete("preferences/theme");
	assert.equal(await first.get("preferences/theme"), undefined);

	await provider.dispose();
	await assert.rejects(() => provider.read("snapshot/latest"), /disposed/);
});

test("logical keys reject traversal and invalid namespaces", () => {
	for (const key of ["../outside", "plugin/../../outside", "/absolute", "a\\b", "a//b"])
		assert.throws(() => validatePersistenceKey(key), /Invalid persistence key/);
});

test("record migrations reject unsupported future versions", () => {
	const registry = new MigrationRegistry();
	const record = createRecord("wsrt.test", { value: 1 }, { workspaceId: "workspace" });
	assert.deepEqual(registry.read(record, "wsrt.test").data, { value: 1 });
	assert.throws(
		() => registry.read({ ...record, version: 2 }, "wsrt.test"),
		/Unsupported wsrt.test record version 2/,
	);
});

test("filesystem persistence writes atomically, orders journals, and releases locks", async () => {
	const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "wsrt-persistence-"));
	try {
		const provider = new FilesystemPersistenceProvider({
			journals: { flushIntervalMs: 60_000, maxFileSizeBytes: 100, maxFiles: 2 },
		});
		await provider.initialize({ workspaceRoot: workspace, sessionId: "one" });
		assert.equal(
			await fs.stat(path.join(workspace, ".wsrt", "locks", "workspace.lock")).then(() => true),
			true,
		);
		await Promise.all(
			Array.from({ length: 20 }, (_, revision) => provider.write("snapshot/latest", { revision })),
		);
		assert.equal(typeof (await provider.read("snapshot/latest"))?.value.revision, "number");
		assert.deepEqual(
			(await fs.readdir(path.join(workspace, ".wsrt", "state"))).filter((name) =>
				name.includes(".tmp-"),
			),
			[],
		);
		for (let sequence = 0; sequence < 8; sequence++)
			await provider.append("journal/events", { sequence }, { flush: true });
		const journal = await provider.readJournal("journal/events");
		assert.deepEqual(
			journal.map((item) => item.sequence),
			journal.map((item) => item.sequence).sort((a, b) => a - b),
		);

		const contender = new FilesystemPersistenceProvider();
		await assert.rejects(
			() => contender.initialize({ workspaceRoot: workspace, sessionId: "two" }),
			/already locked/,
		);
		await contender.dispose();
		await provider.dispose();
		await assert.rejects(() => fs.stat(path.join(workspace, ".wsrt", "locks", "workspace.lock")));

		const reopened = new FilesystemPersistenceProvider();
		await reopened.initialize({ workspaceRoot: workspace, sessionId: "three" });
		await reopened.dispose();
	} finally {
		await fs.rm(workspace, { recursive: true, force: true });
	}
});

test("filesystem journal ignores a malformed trailing record", async () => {
	const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "wsrt-journal-"));
	try {
		const provider = new FilesystemPersistenceProvider();
		await provider.initialize({ workspaceRoot: workspace, sessionId: "journal" });
		const journal = path.join(workspace, ".wsrt", "journals", "events.ndjson");
		await fs.writeFile(journal, '{"sequence":1}\n{"partial":');
		assert.deepEqual(await provider.readJournal("journal/events"), [{ sequence: 1 }]);
		await provider.dispose();
	} finally {
		await fs.rm(workspace, { recursive: true, force: true });
	}
});

test("control plane creates and gracefully completes a runtime session", async () => {
	const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "wsrt-session-"));
	try {
		await fs.writeFile(
			path.join(workspace, "wsrt.config.mjs"),
			"export default { name: 'persistence-test', persistence: false };\n",
		);
		const provider = new MemoryPersistenceProvider();
		const plane = await createControlPlane({ root: workspace, persistence: provider });
		const active = [...provider.entries()]
			.filter(([key]) => key.startsWith("session/"))
			.map(([, entry]) => entry.value.data);
		assert.equal(active.length, 1);
		assert.equal(active[0].endedAt, undefined);
		await plane.dispose();
		const completed = [...provider.entries()]
			.filter(([key]) => key.startsWith("session/"))
			.map(([, entry]) => entry.value.data);
		assert.equal(completed[0].exitReason, "shutdown");
		assert.equal(typeof completed[0].endedAt, "string");
	} finally {
		await fs.rm(workspace, { recursive: true, force: true });
	}
});
