import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { WsrtMcpServer } from "../packages/mcp/dist/server.js";
import { connectOrStartWorkspaceSession } from "../packages/workspace-session/dist/index.js";

const root = path.resolve("tests/fixtures/external-consumer");

const cliExecutable = path.resolve("packages/cli/dist/index.js");

test("representative workspace is equivalent through programmatic, CLI, and MCP clients", async () => {
	const programmatic = await connectOrStartWorkspaceSession({ root });
	const mcpServer = new WsrtMcpServer(programmatic);
	const mcpClient = new Client({ name: "e2e", version: "1" });
	const [mcpClientTransport, mcpServerTransport] = InMemoryTransport.createLinkedPair();
	await mcpServer.connect(mcpServerTransport);
	await mcpClient.connect(mcpClientTransport);
	try {
		const manifest = JSON.parse(
			await fs.readFile(path.join(root, ".wsrt", "workspace-manifest.json"), "utf8"),
		);
		assert.equal(manifest.protocol.name, "wsrt.workspace");

		const description = await programmatic.describeWorkspace();
		assert.ok(description.result.projects.some(({ name }) => name === "@fixture/lib"));
		assert.ok(description.result.projects.some(({ name }) => name === "@fixture/web"));
		assert.ok(description.result.nodes.some(({ id }) => id === "task:webBuild"));

		const node = await programmatic.describeNode("task:webBuild");
		assert.equal(node.result.lifecycleState, "resolved");
		assert.equal(node.result.runtime.runtime, "node");
		assert.equal(
			node.result.files.find(({ path }) => path === "apps/web/dist/**").evidence[0].type,
			"plugin",
		);
		const graph = await programmatic.queryGraph({ roots: ["task:webBuild"], depth: 1 });
		assert.deepEqual(
			graph.result.nodes.map(({ id }) => id),
			["task:hello", "task:webBuild"],
		);
		const files = await programmatic.queryFiles({
			nodeIds: ["task:webBuild"],
			includeGenerated: true,
		});
		assert.deepEqual(
			files.result.files.map(({ path, role }) => ({ path, role })),
			[
				{ path: "apps/lib/src/**", role: "task-input" },
				{ path: "apps/web/dist/**", role: "generated" },
				{ path: "apps/web/index.html", role: "entrypoint" },
				{ path: "apps/web/package.json", role: "configuration" },
				{ path: "apps/web/src.js", role: "source" },
				{ path: "apps/web/src/**", role: "source" },
			],
		);
		const impact = await programmatic.analyzeChangeImpact({ paths: ["apps/lib/src/index.js"] });
		assert.equal(impact.result.confidence, "declared");
		assert.ok(impact.result.affectedNodes.some(({ id }) => id === "task:webBuild"));
		const plan = await programmatic.planCommand({ type: "task.run", taskId: "webBuild" });
		assert.equal(plan.result.valid, true);
		assert.deepEqual(plan.result.requiredPermissions, ["tasks.run"]);

		const cliDescription = JSON.parse((await cli("workspace", "describe", "--json")).stdout);
		const cliGraph = JSON.parse(
			(await cli("workspace", "graph", "task:webBuild", "--depth", "1", "--json")).stdout,
		);
		const cliFiles = JSON.parse(
			(await cli("workspace", "files", "task:webBuild", "--include-generated", "--json")).stdout,
		);
		const cliImpact = JSON.parse(
			(await cli("workspace", "impact", "apps/lib/src/index.js", "--json")).stdout,
		);
		const cliPlan = JSON.parse(
			(await cli("workspace", "command", "plan", "task.run", "webBuild", "--json")).stdout,
		);
		const mcpDescription = await mcpClient.callTool({
			name: "wsrt_workspace_describe",
			arguments: {},
		});
		const mcpGraph = await mcpClient.callTool({
			name: "wsrt_graph_query",
			arguments: { roots: ["task:webBuild"], depth: 1 },
		});
		const mcpFiles = await mcpClient.callTool({
			name: "wsrt_files_query",
			arguments: { nodeIds: ["task:webBuild"], includeGenerated: true },
		});
		const mcpImpact = await mcpClient.callTool({
			name: "wsrt_change_impact",
			arguments: { paths: ["apps/lib/src/index.js"] },
		});
		const mcpPlan = await mcpClient.callTool({
			name: "wsrt_command_plan",
			arguments: { command: { type: "task.run", taskId: "webBuild" } },
		});

		assert.deepEqual(cliDescription.result, description.result);
		assert.deepEqual(mcpDescription.structuredContent.result, description.result);
		assert.deepEqual(cliGraph.result, graph.result);
		assert.deepEqual(mcpGraph.structuredContent.result, graph.result);
		assert.deepEqual(cliFiles.result, files.result);
		assert.deepEqual(mcpFiles.structuredContent.result, files.result);
		assert.deepEqual(cliImpact.result, impact.result);
		assert.deepEqual(mcpImpact.structuredContent.result, impact.result);
		assert.deepEqual(cliPlan.result, plan.result);
		assert.deepEqual(mcpPlan.structuredContent.result, plan.result);
	} finally {
		await mcpClient.close();
		await mcpServer.close();
		await programmatic.stopSession().catch(() => {});
		await programmatic.close().catch(() => {});
	}
});

function cli(...args) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [cliExecutable, ...args, "--root", root], {
			env: { ...process.env, NODE_TEST_CONTEXT: undefined },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.on("error", reject);
		child.on("close", (code) =>
			code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr)),
		);
	});
}
