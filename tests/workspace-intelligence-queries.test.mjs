import assert from "node:assert/strict";
import test from "node:test";
import { SystemGraph } from "../packages/graph/dist/index.js";
import { DefaultWorkspaceIntelligence } from "../packages/workspace-intelligence/dist/index.js";

function service() {
	const graph = new SystemGraph(
		["a", "b", "c", "d"].map((id) => ({ id, name: id, kind: id === "d" ? "task" : "service" })),
		[
			{ from: "a", to: "b", kind: "depends-on" },
			{ from: "b", to: "c", kind: "depends-on" },
			{ from: "d", to: "a", kind: "depends-on" },
		],
	);
	return new DefaultWorkspaceIntelligence({
		workspaceId: "query",
		definition: {
			schemaVersion: "1",
			name: "query",
			root: "/workspace",
			workspace: {},
			runtimes: {},
			executables: ["a", "b", "c"].map((id) => ({
				id,
				name: id,
				kind: "service",
				root: "/workspace",
				runtime: "node",
				command: { command: "node", args: [id], shell: false },
				dependencies: [],
				restart: { policy: "never" },
				critical: true,
				outputs: [],
				environment: {},
				source: { file: "/workspace/wsrt.yml", path: `services.${id}` },
				files: [],
			})),
			artifacts: [],
			environments: {},
			plugins: [],
			persistence: false,
			sourceFile: "/workspace/wsrt.yml",
		},
		graph,
		snapshot: () => ({
			revision: 9,
			generatedAt: "2026-08-02T12:00:00.000Z",
			workspace: { name: "query", root: "/workspace" },
			nodes: [],
			operations: [],
			artifacts: [],
			diagnostics: [],
			events: { size: 0 },
			plugins: [],
			providers: [],
		}),
	});
}

test("graph queries honor direction, depth, kinds, and deterministic limits", () => {
	const intelligence = service();
	assert.deepEqual(
		intelligence.queryGraph({ roots: ["a"], depth: 2 }).nodes.map(({ id }) => id),
		["a", "b", "c"],
	);
	assert.deepEqual(
		intelligence
			.queryGraph({ roots: ["a"], direction: "dependents", depth: 1 })
			.nodes.map(({ id }) => id),
		["a", "d"],
	);
	assert.deepEqual(
		intelligence
			.queryGraph({ roots: ["a"], direction: "both", depth: 1, kinds: ["task"] })
			.nodes.map(({ id }) => id),
		["d"],
	);
	assert.equal(intelligence.queryGraph({ roots: ["a"], depth: 3, limit: 2 }).truncated, true);
});

test("node queries share bounded cursor pagination and reject invalid values", () => {
	const intelligence = service();
	const first = intelligence.queryNodes({ limit: 2 });
	assert.deepEqual(
		first.nodes.map(({ id }) => id),
		["a", "b"],
	);
	assert.ok(first.nextCursor);
	assert.deepEqual(
		intelligence.queryNodes({ limit: 2, cursor: first.nextCursor }).nodes.map(({ id }) => id),
		["c", "d"],
	);
	assert.throws(() => intelligence.queryNodes({ limit: 501 }), { code: "query.limit_invalid" });
	assert.throws(() => intelligence.queryNodes({ cursor: "garbage" }), {
		code: "query.invalid_cursor",
	});
	assert.throws(() => intelligence.queryGraph({ roots: ["a"], depth: 33 }), {
		code: "query.depth_invalid",
	});
	assert.throws(() => intelligence.queryGraph({ roots: ["missing"] }), {
		code: "workspace.node_not_found",
	});
});

test("command planning is read-only and resolves existing command dependencies", () => {
	const intelligence = service();
	const plan = intelligence.planCommand({ type: "node.start", nodeIds: ["a"] });
	assert.equal(plan.valid, true);
	assert.deepEqual(plan.requestedTargets, ["a"]);
	assert.deepEqual(
		plan.actions.map(({ target }) => target),
		["c", "b", "a"],
	);
	assert.deepEqual(plan.executionOrder, ["start:c", "start:b", "start:a"]);
	assert.deepEqual(plan.prerequisiteActions, ["start:c", "start:b"]);
	assert.deepEqual(plan.requiredPermissions, ["nodes.start"]);
	assert.equal(plan.risk, "low");
	const invalid = intelligence.planCommand({ type: "node.stop", nodeIds: ["missing"] });
	assert.equal(invalid.valid, false);
	assert.match(invalid.warnings[0], /does not exist/);
});
