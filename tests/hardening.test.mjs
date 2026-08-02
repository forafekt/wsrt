import assert from "node:assert/strict";
import test from "node:test";
import { ProviderRegistry } from "@wsrt/capabilities";
import { createControlPlane } from "@wsrt/control-plane";
import { EventJournal } from "@wsrt/events";
import { orderPlugins, PluginSession } from "@wsrt/plugins";

test("plugins order deterministically and validate dependencies", async () => {
	const disposed = [];
	const plugins = [
		{
			id: "b",
			version: "1",
			requires: ["a"],
			dispose: () => disposed.push("b"),
		},
		{ id: "a", version: "1", dispose: () => disposed.push("a") },
	];
	assert.deepEqual(
		orderPlugins(plugins).map((plugin) => plugin.id),
		["a", "b"],
	);
	const session = new PluginSession(plugins);
	await session.dispose();
	assert.deepEqual(disposed, ["b", "a"]);
	assert.throws(
		() => orderPlugins([{ id: "a", version: "1", requires: ["missing"] }]),
		/requires missing/,
	);
	assert.throws(
		() =>
			orderPlugins([
				{ id: "a", version: "1", requires: ["b"] },
				{ id: "b", version: "1", requires: ["a"] },
			]),
		/cycle/,
	);
	assert.throws(
		() =>
			orderPlugins([
				{ id: "a", version: "1" },
				{ id: "a", version: "2" },
			]),
		/Duplicate plugin ID/,
	);
});

test("executable contributions are isolated, owned, and unique", () => {
	const executable = {
		id: "devtools",
		owner: { id: "tools", version: "1" },
		async execute() {
			return "done";
		},
	};
	const session = new PluginSession([
		{ id: "tools", version: "1", contributions: { executables: [executable] } },
	]);
	assert.equal(session.executable("devtools"), executable);
	assert.equal(session.executable("missing"), undefined);
	assert.throws(
		() =>
			new PluginSession([
				{
					id: "a",
					version: "1",
					contributions: {
						executables: [{ ...executable, owner: { id: "a", version: "1" } }],
					},
				},
				{
					id: "b",
					version: "1",
					contributions: {
						executables: [{ ...executable, owner: { id: "b", version: "1" } }],
					},
				},
			]),
		/Duplicate executables contribution/,
	);
	assert.throws(
		() =>
			new PluginSession([
				{
					id: "tools",
					version: "1",
					contributions: { executables: [{ ...executable, owner: undefined }] },
				},
			]),
		/missing or incorrect owner/,
	);
});

test("provider registries are isolated and reject duplicate owned IDs", () => {
	const provider = {
		id: "command",
		validate: () => ({ options: {}, diagnostics: [] }),
		prepare: () => ({ command: "node", args: [] }),
	};
	const first = new ProviderRegistry().register({
		kind: "execution",
		id: "command",
		owner: "first",
		provider,
	});
	const second = new ProviderRegistry().register({
		kind: "execution",
		id: "command",
		owner: "second",
		provider,
	});
	assert.equal(first.list()[0].owner, "first");
	assert.equal(second.list()[0].owner, "second");
	assert.throws(
		() =>
			first.register({
				kind: "execution",
				id: "command",
				owner: "duplicate",
				provider,
			}),
		/Duplicate execution provider/,
	);
	assert.throws(() => first.get("runtime", "missing"), /Provider not found/);
});

test("event journal is bounded, sequenced, immutable and queryable", () => {
	const journal = new EventJournal({ maximumSize: 2 });
	for (const [index, source] of ["one", "two", "two"].entries())
		journal.publish({
			id: String(index),
			type: index === 2 ? "health.failed" : "health.ok",
			timestamp: new Date(index).toISOString(),
			source,
			correlationId: "operation",
			operationId: "op",
			payload: {},
		});
	assert.deepEqual(
		journal.list().map((event) => event.sequence),
		[2, 3],
	);
	assert.equal(journal.query({ source: "two" }).length, 2);
	assert.equal(journal.query({ type: "health.failed", sinceSequence: 2 }).length, 1);
	assert.equal(Object.isFrozen(journal.list()[0]), true);
});

test("control-plane snapshots are immutable, revisioned and operation-backed", async () => {
	const plane = await createControlPlane({ root: "examples/system-lifecycle" });
	const revisions = [];
	const unsubscribe = plane.subscribeSnapshots((snapshot) => revisions.push(snapshot.revision));
	try {
		const before = plane.snapshot();
		const result = await plane.runTask("contracts");
		const after = plane.snapshot();
		assert.ok(result.operationId);
		assert.ok(after.revision > before.revision);
		assert.equal(after.operations.at(-1).status, "completed");
		assert.equal(Object.isFrozen(after), true);
		assert.equal(Object.isFrozen(after.nodes), true);
		assert.ok(revisions.length >= 3);
	} finally {
		unsubscribe();
		await plane.dispose();
	}
});
