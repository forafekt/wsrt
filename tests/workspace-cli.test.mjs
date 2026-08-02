import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const executable = path.resolve("packages/cli/dist/index.js");

test("workspace CLI preserves protocol JSON response semantics", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "wsrt-workspace-cli-"));
	await fs.writeFile(
		path.join(root, "wsrt.json"),
		JSON.stringify({
			name: "cli-workspace",
			applications: { web: { sources: ["src/**"], tests: ["tests/**"] } },
		}),
	);
	try {
		const describe = await cli(root, "workspace", "describe", "--json");
		assert.equal(describe.code, 0, describe.stderr);
		const response = JSON.parse(describe.stdout);
		assert.equal(response.metadata.protocolVersion, 1);
		assert.equal(response.result.workspace.name, "cli-workspace");
		const files = await cli(
			root,
			"workspace",
			"files",
			"application:web",
			"--role",
			"source",
			"--json",
		);
		assert.equal(files.code, 0, files.stderr);
		assert.deepEqual(
			JSON.parse(files.stdout).result.files.map(({ path }) => path),
			["src/**"],
		);
		const graph = await cli(
			root,
			"workspace",
			"graph",
			"application:web",
			"--depth",
			"1",
			"--json",
		);
		assert.equal(graph.code, 0, graph.stderr);
		assert.equal(JSON.parse(graph.stdout).result.nodes[0].id, "application:web");
	} finally {
		await cli(root, "session", "stop", "--json");
		await fs.rm(root, { recursive: true, force: true });
	}
});

function cli(root, ...args) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [executable, ...args, "--root", root], {
			env: { ...process.env, NODE_TEST_CONTEXT: undefined },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.on("error", reject);
		child.on("close", (code) => resolve({ code, stdout, stderr }));
	});
}
