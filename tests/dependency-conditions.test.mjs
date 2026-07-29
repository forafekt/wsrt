import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSystemDefinition } from "../packages/config/dist/index.js";
import { createControlPlane } from "../packages/control-plane/dist/index.js";

/** Binds late, so readiness and health are observably later than the spawn. */
const dependencyScript = `import http from "node:http";
import fs from "node:fs";
const log = (line) => fs.appendFileSync(process.env.LOG, line + "\\n");
log("dep:start");
const server = http.createServer((_request, response) => {
	log("dep:check");
	response.writeHead(200).end("ok");
});
setTimeout(
	() => server.listen(Number(process.env.DEP_PORT), "127.0.0.1", () => log("dep:listening")),
	250,
);
`;

const dependantScript = `import fs from "node:fs";
fs.appendFileSync(process.env.LOG, "web:start\\n");
setInterval(() => {}, 1000);
`;

const failingTaskScript = `import fs from "node:fs";
fs.appendFileSync(process.env.LOG, "task:failed\\n");
process.exit(1);
`;

let nextPort = 21_000;

/** Spawning resolves before the child has written its marker; wait for the write. */
async function waitFor(read, marker, timeoutMs = 5_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const lines = await read();
		if (lines.includes(marker)) return lines;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(`Timed out waiting for "${marker}": ${(await read()).join(",")}`);
}

async function workspace(t, { condition, healthyThreshold, dependency = "service" }) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "wsrt-condition-"));
	const port = nextPort++;
	const log = path.join(root, "log.txt");
	await fs.writeFile(log, "");
	await fs.writeFile(path.join(root, "dep.mjs"), dependencyScript);
	await fs.writeFile(path.join(root, "web.mjs"), dependantScript);
	await fs.writeFile(path.join(root, "task.mjs"), failingTaskScript);
	const dependencyNode =
		dependency === "service"
			? `services:
  dep:
    command: { command: node, args: [dep.mjs] }
    environment: { LOG: "${log}", DEP_PORT: "${port}" }
    healthcheck:
      type: http
      url: "http://127.0.0.1:${port}/"
      intervalMs: 50
      healthyThreshold: ${healthyThreshold ?? 1}
`
			: `tasks:
  dep:
    command: { command: node, args: [task.mjs] }
    environment: { LOG: "${log}" }
`;
	await fs.writeFile(
		path.join(root, "wsrt.yaml"),
		`schemaVersion: "1"
name: conditions
${dependencyNode}applications:
  web:
    command: { command: node, args: [web.mjs] }
    environment: { LOG: "${log}" }
    healthcheck: { type: process }
    dependsOn: { dep: { condition: ${condition} } }
`,
	);
	const plane = await createControlPlane({ root, persistence: false });
	t.after(async () => {
		await plane.dispose().catch(() => {});
		await fs.rm(root, { force: true, recursive: true });
	});
	return { plane, read: async () => (await fs.readFile(log, "utf8")).trim().split("\n") };
}

test("condition started admits a dependant before its dependency is ready", async (t) => {
	const { plane, read } = await workspace(t, { condition: "started" });
	await plane.start(["web"]);
	const lines = await waitFor(read, "web:start");
	assert.ok(
		lines.indexOf("web:start") < lines.indexOf("dep:listening"),
		`expected web:start before dep:listening, saw ${lines.join(",")}`,
	);
});

test("condition ready holds a dependant until the dependency passes readiness", async (t) => {
	const { plane, read } = await workspace(t, { condition: "ready" });
	await plane.start(["web"]);
	const lines = await waitFor(read, "web:start");
	assert.ok(
		lines.indexOf("dep:listening") < lines.indexOf("web:start"),
		`expected dep:listening before web:start, saw ${lines.join(",")}`,
	);
	assert.equal(plane.getNodeState("application:web"), "ready");
});

test("condition healthy holds a dependant until the health threshold is met", async (t) => {
	const { plane, read } = await workspace(t, { condition: "healthy", healthyThreshold: 3 });
	await plane.start(["web"]);
	const lines = await waitFor(read, "web:start");
	const checksBefore = lines
		.slice(0, lines.indexOf("web:start"))
		.filter((line) => line === "dep:check").length;
	// One check satisfies readiness; three consecutive successes satisfy health.
	assert.ok(
		checksBefore >= 4,
		`expected readiness plus 3 health checks before web:start, saw ${checksBefore} in ${lines.join(",")}`,
	);
	assert.equal(plane.snapshot().nodes.find((node) => node.id === "service:dep").health, "healthy");
});

test("condition successful blocks a dependant when its task fails", async (t) => {
	const { plane, read } = await workspace(t, { condition: "successful", dependency: "task" });
	await assert.rejects(() => plane.start(["web"]));
	assert.equal(plane.getNodeState("task:dep"), "failed");
	assert.equal(plane.getNodeState("application:web"), "blocked");
	assert.ok(!(await read()).includes("web:start"));
	assert.equal(
		plane
			.listOperations()
			.at(-1)
			.results.find((item) => item.nodeId === "application:web").status,
		"blocked",
	);
});

test("condition completed admits a dependant even when its task fails", async (t) => {
	const { plane, read } = await workspace(t, { condition: "completed", dependency: "task" });
	// The failed task still fails the operation, but it must not gate the dependant.
	await assert.rejects(() => plane.start(["web"]));
	assert.equal(plane.getNodeState("task:dep"), "failed");
	assert.equal(plane.getNodeState("application:web"), "ready");
	await waitFor(read, "web:start");
});

test("unsatisfiable conditions are rejected while normalizing configuration", async (t) => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "wsrt-condition-diag-"));
	t.after(() => fs.rm(root, { force: true, recursive: true }));
	await fs.writeFile(
		path.join(root, "wsrt.yaml"),
		`schemaVersion: "1"
name: invalid
services:
  api: { command: { command: node, args: [-e, "0"] } }
tasks:
  build: { command: { command: node, args: [-e, "0"] } }
applications:
  web:
    command: { command: node, args: [-e, "0"] }
    dependsOn:
      api: { condition: successful }
      build: { condition: healthy }
`,
	);
	const loaded = await loadSystemDefinition(root, "wsrt.yaml");
	assert.equal(loaded.definition, undefined);
	assert.deepEqual(
		loaded.diagnostics.map((item) => item.code),
		["config.dependency_condition_unsatisfiable", "config.dependency_condition_unsatisfiable"],
	);
	assert.deepEqual(
		loaded.diagnostics.map((item) => item.source.path),
		["applications.web.dependsOn.api.condition", "applications.web.dependsOn.build.condition"],
	);
	assert.match(loaded.diagnostics[0].message, /requires a task/);
	assert.match(loaded.diagnostics[1].message, /never reports health/);
});

test("a dependency without a declared condition normalizes to ready", async (t) => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "wsrt-condition-default-"));
	t.after(() => fs.rm(root, { force: true, recursive: true }));
	await fs.writeFile(
		path.join(root, "wsrt.yaml"),
		`schemaVersion: "1"
name: defaults
services:
  api: { command: { command: node, args: [-e, "0"] } }
applications:
  web: { command: { command: node, args: [-e, "0"] }, dependsOn: [api] }
`,
	);
	const loaded = await loadSystemDefinition(root, "wsrt.yaml");
	assert.equal(loaded.diagnostics.length, 0);
	assert.deepEqual(loaded.definition.executables.find((item) => item.name === "web").dependencies, [
		{ id: "api", condition: "ready" },
	]);
});
