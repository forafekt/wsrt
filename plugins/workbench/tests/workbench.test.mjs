import assert from "node:assert/strict";
import test from "node:test";
import {
	createWorkbenchServer,
	normalizeWorkbenchOptions,
	workbenchPlugin,
} from "../dist/index.js";

test("normalizes independent defaults and validates unsafe options", () => {
	const options = normalizeWorkbenchOptions();
	assert.equal(options.port, 5178);
	assert.equal(options.basePath, "/__wsrt/workbench");
	assert.throws(() => normalizeWorkbenchOptions({ basePath: "../bad" }), /base path/);
	assert.throws(() => normalizeWorkbenchOptions({ port: 70_000 }), /port/);
});

test("registers the workbench executable without dashboard ownership", () => {
	const plugin = workbenchPlugin();
	assert.equal(plugin.id, "@wsrt/plugin-workbench");
	assert.deepEqual(plugin.capabilities, ["cli"]);
	assert.equal(plugin.contributions.executables?.[0]?.id, "workbench");
	assert.equal(JSON.stringify(plugin).includes("plugin-dashboard"), false);
});

test("serves deep routes and forwards only authoritative operations", async (t) => {
	const listeners = new Set();
	const fake = {
		describeWorkspace: async () => ({
			metadata: { protocolVersion: 2 },
			result: {
				workspaceRevision: 4,
				workspace: { id: "test", name: "Test" },
				nodes: [],
				projects: [],
				capabilities: [],
			},
		}),
		getStarted: async () => ({ result: { importantNodeIds: [] } }),
		snapshot: async () => ({ revision: 4 }),
		operations: async () => [],
		diagnostics: async () => [],
		artifacts: async () => [],
		status: async () => ({}),
		handshake: () => ({ protocolVersion: 2, workspaceId: "test" }),
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		request: async (request) => ({ metadata: { workspaceRevision: 4 }, result: request.type }),
	};
	const handle = await createWorkbenchServer(fake, { port: 0 });
	t.after(() => handle.close());
	const page = await fetch(`${handle.url}/nodes`);
	assert.equal(page.status, 200);
	assert.match(await page.text(), /WSRT Workbench/);
	const result = await fetch(`${handle.url}/api/request`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ type: "workspace.nodes.query", query: { limit: 10 } }),
	});
	assert.equal(result.status, 200);
	assert.equal((await result.json()).result, "workspace.nodes.query");
	const rejected = await fetch(`${handle.url}/api/request`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ type: "definition.get" }),
	});
	assert.equal(rejected.status, 400);
});
