import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { WsrtMcpServer } from "../packages/mcp/dist/server.js";

function fixture() {
	const context = Object.freeze({
		root: "/workspace",
		configuration: {},
		logger: { info() {}, warn() {}, error() {} },
		diagnostics: { add() {} },
		events: { emit() {} },
		services: {},
	});
	const contributions = [
		{ id: "echo", kind: "tool", description: "Echo", run: (input) => input },
		{
			id: "slow",
			kind: "tool",
			run: (_input, _context, signal) =>
				new Promise((_resolve, reject) => {
					const abort = () => reject(signal.reason ?? new Error("cancelled"));
					signal.addEventListener("abort", abort, { once: true });
				}),
		},
		{ id: "readme", kind: "resource", run: () => ({ text: "hello" }) },
		{
			id: "review",
			kind: "prompt",
			run: (input) => ({
				messages: [{ role: "user", content: { type: "text", text: String(input) } }],
			}),
		},
	];
	const plane = {
		pluginContributions: () => contributions,
		snapshot: () => ({
			plugins: [
				{
					id: "fixture",
					contributions: contributions.map((item) => ({
						id: item.id,
						kind: "mcp",
					})),
				},
			],
		}),
		invokePluginContribution: async (_kind, _id, run) => run(context),
	};
	return plane;
}

async function connected(options) {
	const server = new WsrtMcpServer(fixture(), options);
	const client = new Client({ name: "test", version: "1" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	await client.connect(clientTransport);
	return { server, client, clientTransport };
}

test("MCP transport discovers and invokes namespaced plugin contributions", async () => {
	const { server, client } = await connected();
	try {
		const tools = await client.listTools();
		assert.ok(tools.tools.some((item) => item.name === "fixture.echo"));
		assert.deepEqual(
			(await client.listTools()).tools.map((item) => item.name),
			tools.tools.map((item) => item.name),
		);
		const resources = await client.listResources();
		const resource = resources.resources.find((item) => item.name === "fixture.readme");
		assert.ok(resource);
		const prompts = await client.listPrompts();
		assert.ok(prompts.prompts.some((item) => item.name === "fixture.review"));
		const called = await client.callTool({
			name: "fixture.echo",
			arguments: { input: { value: 1 } },
		});
		assert.deepEqual(called.structuredContent, { value: 1 });
		const read = await client.readResource({ uri: resource.uri });
		assert.deepEqual(JSON.parse(read.contents[0].text), { text: "hello" });
		const prompt = await client.getPrompt({
			name: "fixture.review",
			arguments: { input: "code" },
		});
		assert.equal(prompt.messages[0].content.text, "code");
	} finally {
		await client.close();
		await server.close();
	}
});

test("MCP transport cancellation and shutdown abort active plugin work", async () => {
	const { server, client } = await connected();
	const controller = new AbortController();
	const pending = client.callTool({ name: "fixture.slow", arguments: {} }, undefined, {
		signal: controller.signal,
	});
	controller.abort(new Error("test cancellation"));
	await assert.rejects(pending, /cancel|abort/i);
	await server.close();
	await assert.rejects(
		client.callTool({ name: "fixture.echo", arguments: {} }),
		/closed|not connected|connection/i,
	);
	await client.close();
});

test("MCP transport isolates unknown calls and permission denial", async () => {
	const { server, client } = await connected({ allowMutations: false });
	try {
		const unknown = await client.callTool({
			name: "fixture.missing",
			arguments: {},
		});
		assert.equal(unknown.isError, true);
		const denied = await client.callTool({
			name: "workspace.start",
			arguments: { input: {} },
		});
		assert.equal(denied.isError, true);
		assert.match(denied.content[0].text, /disabled|permission/i);
	} finally {
		await client.close();
		await server.close();
	}
});

test("MCP workspace intelligence tools are thin structured session-client adapters", async () => {
	const calls = [];
	const response = (operation, result) => ({
		metadata: {
			protocolVersion: 1,
			workspaceRevision: 4,
			generatedAt: "2026-08-02T12:00:00.000Z",
			requestId: operation,
		},
		result,
	});
	const session = {
		request() {},
		getCapabilities: async (options) => {
			calls.push(["capabilities", options]);
			return response("capabilities", []);
		},
		describeWorkspace: async (options) => {
			calls.push(["describe", options]);
			return response("describe", { workspace: { name: "test" } });
		},
		getStarted: async (options) => {
			calls.push(["get-started", options]);
			return response("get-started", { recommendedCalls: [] });
		},
		queryNodes: async (query, options) => {
			calls.push(["nodes", query, options]);
			return response("nodes", { nodes: [] });
		},
		describeNode: async (id, options) => {
			calls.push(["node", id, options]);
			return response("node", { id });
		},
		queryGraph: async (query, options) => {
			calls.push(["graph", query, options]);
			return response("graph", { nodes: [] });
		},
		queryFiles: async (query, options) => {
			calls.push(["files", query, options]);
			return response("files", { files: [] });
		},
		fileOwners: async (path, options) => {
			calls.push(["owners", path, options]);
			return response("owners", { files: [] });
		},
		analyzeChangeImpact: async (query, options) => {
			calls.push(["impact", query, options]);
			return response("impact", { affectedNodes: [] });
		},
		recommendValidation: async (query, options) => {
			calls.push(["validation", query, options]);
			return response("validation", { recommendations: [] });
		},
		planCommand: async (command, options) => {
			calls.push(["plan", command, options]);
			return response("plan", { valid: true });
		},
		executeWorkspaceCommand: async (command, options) => {
			calls.push(["execute", command, options]);
			return response("execute", { status: "completed" });
		},
	};
	const server = new WsrtMcpServer(session);
	const client = new Client({ name: "test", version: "1" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	await client.connect(clientTransport);
	try {
		const tools = await client.listTools();
		for (const name of [
			"wsrt_workspace_capabilities",
			"wsrt_workspace_describe",
			"wsrt_workspace_get_started",
			"wsrt_node_describe",
			"wsrt_nodes_query",
			"wsrt_graph_query",
			"wsrt_files_query",
			"wsrt_change_impact",
			"wsrt_file_owners",
			"wsrt_validation_recommend",
			"wsrt_command_plan",
			"wsrt_command_execute",
		]) {
			const tool = tools.tools.find((item) => item.name === name);
			assert.ok(tool, name);
			assert.match(tool.description, /authoritative/i);
		}
		await client.callTool({ name: "wsrt_workspace_capabilities", arguments: {} });
		await client.callTool({ name: "wsrt_workspace_describe", arguments: {} });
		await client.callTool({ name: "wsrt_workspace_get_started", arguments: {} });
		await client.callTool({ name: "wsrt_nodes_query", arguments: { kinds: ["process"] } });
		const node = await client.callTool({
			name: "wsrt_node_describe",
			arguments: { nodeId: "application:web", aggregate: true, depth: 2 },
		});
		await client.callTool({
			name: "wsrt_graph_query",
			arguments: { roots: ["application:web"], depth: 2 },
		});
		await client.callTool({
			name: "wsrt_files_query",
			arguments: { nodeIds: ["application:web"], roles: ["source"] },
		});
		await client.callTool({
			name: "wsrt_change_impact",
			arguments: { paths: ["src/main.ts"], expand: ["evidence"] },
		});
		await client.callTool({ name: "wsrt_file_owners", arguments: { path: "src/main.ts" } });
		await client.callTool({
			name: "wsrt_validation_recommend",
			arguments: { paths: ["src/main.ts"] },
		});
		await client.callTool({
			name: "wsrt_command_plan",
			arguments: { command: { type: "node.start", nodeIds: ["application:web"] } },
		});
		assert.equal(node.structuredContent.result.id, "application:web");
		assert.deepEqual(
			calls.map(([operation]) => operation),
			[
				"capabilities",
				"describe",
				"get-started",
				"nodes",
				"node",
				"graph",
				"files",
				"impact",
				"owners",
				"validation",
				"plan",
			],
		);
		assert.deepEqual(calls[3][1], { kinds: ["process"] });
		assert.equal(calls[4][1], "application:web");
		assert.equal(calls[4][2].aggregate, true);
		assert.deepEqual(calls[5][1], { roots: ["application:web"], depth: 2 });
		assert.deepEqual(calls[6][1], { nodeIds: ["application:web"], roles: ["source"] });
		assert.deepEqual(calls[7][1], { paths: ["src/main.ts"], expand: ["evidence"] });
		assert.equal(calls[8][1], "src/main.ts");
		assert.deepEqual(calls[9][1], { paths: ["src/main.ts"] });
		assert.deepEqual(calls[10][1], { type: "node.start", nodeIds: ["application:web"] });
		const denied = await client.callTool({
			name: "wsrt_command_execute",
			arguments: { command: { type: "node.start", nodeIds: ["application:web"] } },
		});
		assert.equal(denied.isError, true);
	} finally {
		await client.close();
		await server.close();
	}
});
