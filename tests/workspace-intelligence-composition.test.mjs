import assert from "node:assert/strict";
import test from "node:test";
import { SystemGraph } from "../packages/graph/dist/index.js";
import { DefaultWorkspaceIntelligence } from "../packages/workspace-intelligence/dist/index.js";

test("composes a deterministic immutable snapshot from existing authorities", () => {
	const graph = new SystemGraph(
		[
			{ id: "service:api", kind: "service", name: "api" },
			{ id: "application:web", kind: "application", name: "web" },
		],
		[{ from: "application:web", to: "service:api", kind: "depends-on", condition: "ready" }],
	);
	const definition = {
		schemaVersion: "1",
		name: "example",
		root: "/workspace",
		workspace: { packageManager: "pnpm" },
		runtimes: {},
		executables: [
			{
				id: "application:web",
				name: "web",
				kind: "application",
				root: "/workspace/apps/web",
				runtime: "node",
				dependencies: [],
				restart: { policy: "never" },
				critical: true,
				outputs: [],
				environment: {},
				source: { file: "/workspace/wsrt.config.ts", path: "applications.web" },
			},
		],
		artifacts: [],
		environments: {},
		plugins: [],
		persistence: false,
		sourceFile: "/workspace/wsrt.config.ts",
	};
	const live = {
		revision: 7,
		generatedAt: "2026-08-02T12:00:00.000Z",
		workspace: { name: "example", root: "/workspace" },
		nodes: [
			{
				id: "application:web",
				kind: "application",
				state: "ready",
				health: "healthy",
				runtime: "node",
				restartCount: 0,
				consecutiveSuccesses: 1,
				consecutiveFailures: 0,
				restartPending: false,
				currentRestartAttempt: 0,
			},
		],
		operations: [],
		artifacts: [],
		diagnostics: [],
		events: { size: 0 },
		plugins: [],
		providers: [],
	};
	const intelligence = new DefaultWorkspaceIntelligence({
		workspaceId: "workspace-1",
		definition,
		graph,
		snapshot: () => live,
		hostFeatures: { protocolVersion: 1, transports: ["ipc"], subscriptions: true },
	});
	const first = intelligence.describeWorkspace();
	const second = intelligence.describeWorkspace();
	assert.deepEqual(first, second);
	assert.equal(first.workspaceRevision, 7);
	assert.deepEqual(
		first.nodes.map(({ id }) => id),
		["application:web", "service:api"],
	);
	assert.equal(first.nodes[0].health.state, "healthy");
	assert.ok(Object.isFrozen(first));
	assert.ok(Object.isFrozen(first.nodes[0].evidence));
	assert.deepEqual(
		first.capabilities.find(({ id }) => id === "workspace.node-kinds").details.supported,
		["application", "service"],
	);
	assert.equal(first.capabilities.find(({ id }) => id === "subscriptions").available, true);
	assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
});

test("missing node errors are structured", () => {
	const intelligence = new DefaultWorkspaceIntelligence({
		workspaceId: "workspace-1",
		definition: {
			schemaVersion: "1",
			name: "empty",
			root: "/workspace",
			workspace: {},
			runtimes: {},
			executables: [],
			artifacts: [],
			environments: {},
			plugins: [],
			persistence: false,
			sourceFile: "/workspace/wsrt.config.ts",
		},
		graph: new SystemGraph(),
		snapshot: () => ({
			revision: 1,
			generatedAt: "2026-08-02T12:00:00.000Z",
			workspace: { name: "empty", root: "/workspace" },
			nodes: [],
			operations: [],
			artifacts: [],
			diagnostics: [],
			events: { size: 0 },
			plugins: [],
			providers: [],
		}),
	});
	assert.throws(() => intelligence.describeNode("missing"), { code: "workspace.node_not_found" });
});
