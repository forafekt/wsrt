import assert from "node:assert/strict";
import test from "node:test";
import { ProviderRegistry } from "@wsrt/capabilities";
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
	const journal = new EventJournal(2);
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
	assert.equal(
		journal.query({ type: "health.failed", sinceSequence: 2 }).length,
		1,
	);
	assert.equal(Object.isFrozen(journal.list()[0]), true);
});
