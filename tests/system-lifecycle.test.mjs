import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadSystemDefinition } from "@wsrt/config";
import { createControlPlane } from "@wsrt/control-plane";
import { runMcpTool } from "@wsrt/mcp";
import { dashboardSnapshot } from "@wsrt/plugin-dashboard";

const root = path.resolve("examples/system-lifecycle");

import wsrtVitePlugin, { hasWsrtVitePlugin, viteContribution } from "@wsrt/plugin-vite";

test("TS and YAML normalize equivalently and compile deterministic graph", async () => {
	const ts = await loadSystemDefinition(root, "wsrt.config.ts"),
		yaml = await loadSystemDefinition(root, "wsrt.yaml");
	assert.equal(ts.diagnostics.length, 0);
	assert.equal(yaml.diagnostics.length, 0);
	assert.deepEqual(structure(ts.definition), structure(yaml.definition));
	const plane = await createControlPlane({ root });
	try {
		assert.deepEqual(plane.plan(["application:web"]).order, ["service:api", "application:web"]);
		assert.equal(plane.getDependencies("application:web")[0].id, "service:api");
		assert.equal(plane.getConsumers("service:api")[0].id, "application:web");
	} finally {
		await plane.dispose();
	}
});
test("control plane runs artifact task and shares data with MCP and dashboard", async () => {
	const generated = path.join(root, "generated/api-client.ts");
	fs.rmSync(path.dirname(generated), { recursive: true, force: true });
	const plane = await createControlPlane({ root });
	try {
		await plane.runTask("contracts");
		assert.equal(fs.existsSync(generated), true);
		assert.equal(plane.listArtifacts()[0].status, "ready");
		const overview = await runMcpTool(plane, { tool: "workspace.overview" });
		assert.equal(overview.name, "system-lifecycle");
		assert.equal(dashboardSnapshot(plane).graph.nodes.length > 0, true);
	} finally {
		await plane.dispose();
		fs.rmSync(path.dirname(generated), { recursive: true, force: true });
	}
});
test("real API/web dependency reaches readiness and stops cleanly", async () => {
	const plane = await createControlPlane({ root });
	try {
		const result = await plane.start(["web"]);
		assert.equal(result.states["service:api"], "ready");
		assert.equal(result.states["application:web"], "ready");
		assert.ok(
			["checking", "healthy"].includes(
				plane.snapshot().nodes.find((item) => item.id === "application:web").health,
			),
		);
		await plane.stop(["api"]);
		assert.equal(plane.getNodeState("application:web"), "stopped");
		assert.equal(plane.getNodeState("service:api"), "stopped");
	} finally {
		await plane.dispose();
	}
});
test("composite application expands, starts, restarts a child, and stops all children", async () => {
	const plane = await createControlPlane({ root });
	try {
		const started = await plane.start(["desktop"]);
		assert.equal(started.states["application:desktop"], "ready");
		assert.equal(started.states["application:desktop/process:main"], "ready");
		assert.equal(started.states["application:desktop/process:worker"], "ready");
		await plane.restart(["application:desktop/process:main"]);
		assert.equal(plane.getNodeState("application:desktop/process:main"), "ready");
		await plane.stop(["desktop"]);
		assert.equal(plane.getNodeState("application:desktop/process:main"), "stopped");
		assert.equal(plane.getNodeState("application:desktop/process:worker"), "stopped");
	} finally {
		await plane.dispose();
	}
});
test("Vite is an explicit command and readiness contribution", () => {
	const contribution = viteContribution({ host: "127.0.0.1", port: 5199 });
	assert.match(contribution.command.args[0], /vite\.js$/);
	assert.deepEqual(contribution.command.args.slice(1), [
		"dev",
		"--host",
		"127.0.0.1",
		"--port",
		"5199",
	]);
	assert.equal(contribution.healthcheck.url, "http://127.0.0.1:5199");
	assert.equal(hasWsrtVitePlugin([wsrtVitePlugin()]), true);
});
function structure(value) {
	return {
		...value,
		sourceFile: undefined,
		executables: value.executables.map((item) => ({
			...item,
			source: undefined,
		})),
		artifacts: value.artifacts.map((item) => ({ ...item, source: undefined })),
	};
}
