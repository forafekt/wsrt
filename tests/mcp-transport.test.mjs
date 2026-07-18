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
				messages: [
					{ role: "user", content: { type: "text", text: String(input) } },
				],
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
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
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
		const resource = resources.resources.find(
			(item) => item.name === "fixture.readme",
		);
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
	const pending = client.callTool(
		{ name: "fixture.slow", arguments: {} },
		undefined,
		{ signal: controller.signal },
	);
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
