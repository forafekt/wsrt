import assert from "node:assert/strict";
import test from "node:test";
import { getMcpPrompt, readMcpResource, runMcpTool } from "@wsrt/mcp";
import { PluginSession } from "@wsrt/plugins";

const owner = { id: "fixture", version: "1.0.0" };
const context = Object.freeze({
	root: "/workspace",
	configuration: {},
	logger: { info() {}, warn() {}, error() {} },
	diagnostics: { add() {} },
	events: { emit() {} },
	services: {},
});

test("contribution invocations are attributed and reflected in snapshots", async () => {
	const session = new PluginSession([
		{
			...owner,
			contributions: {
				completion: [{ id: "values", complete: () => ["alpha"] }],
				diagnostics: [
					{
						id: "notice",
						code: "fixture.notice",
						severity: "info",
						message: "notice",
					},
				],
			},
		},
	]);
	assert.deepEqual(
		await session.invoke("completion", "values", context, (scoped) =>
			session.contributions("completion")[0].complete("a", scoped),
		),
		["alpha"],
	);
	const snapshot = session.snapshots()[0];
	assert.equal(snapshot.contributions.find((item) => item.id === "values").status, "operational");
	assert.ok(snapshot.contributions.find((item) => item.id === "values").lastInvokedAt);
	assert.equal(snapshot.contributions.find((item) => item.id === "notice").status, "declarative");
	await session.dispose();
	await session.dispose();
	await assert.rejects(() => session.invoke("completion", "values", context, () => []), /disposed/);
});

test("plugin MCP tools, resources and prompts use namespaced scoped invocations", async () => {
	const contributions = [
		{ id: "echo", kind: "tool", run: (input) => input },
		{ id: "readme", kind: "resource", run: () => ({ text: "hello" }) },
		{ id: "review", kind: "prompt", run: (input) => ({ messages: [input] }) },
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
	assert.deepEqual(await runMcpTool(plane, { tool: "fixture/echo", input: { value: 1 } }), {
		value: 1,
	});
	assert.deepEqual(await readMcpResource(plane, "fixture/readme"), {
		text: "hello",
	});
	assert.deepEqual(await getMcpPrompt(plane, "fixture/review", { topic: "code" }), {
		messages: [{ topic: "code" }],
	});
});
