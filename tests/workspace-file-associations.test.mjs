import assert from "node:assert/strict";
import test from "node:test";
import { compileSystemGraph, normalizeSystemDefinition } from "../packages/config/dist/index.js";
import { DefaultWorkspaceIntelligence } from "../packages/workspace-intelligence/dist/index.js";

const live = {
	revision: 1,
	generatedAt: "2026-08-02T12:00:00.000Z",
	workspace: { name: "files", root: "/workspace" },
	nodes: [],
	operations: [],
	artifacts: [],
	diagnostics: [],
	events: { size: 0 },
	plugins: [],
	providers: [],
};

function intelligence() {
	const normalized = normalizeSystemDefinition(
		{
			name: "files",
			applications: {
				desktop: {
					processes: {
						main: {
							command: { command: "electron", args: ["."], shell: false },
							healthcheck: { type: "http", url: "http://127.0.0.1:3316" },
							environment: { RENDERER_URL: "http://127.0.0.1:3316" },
							entrypoints: ["apps\\desktop\\src\\main.ts"],
							sources: ["apps/desktop/src/**"],
							generated: ["apps/desktop/dist/**"],
						},
					},
				},
			},
		},
		{ root: "/workspace", file: "/workspace/wsrt.config.ts" },
	);
	assert.deepEqual(normalized.diagnostics, []);
	return new DefaultWorkspaceIntelligence({
		workspaceId: "files",
		definition: normalized.definition,
		graph: compileSystemGraph(normalized.definition),
		snapshot: () => live,
	});
}

test("associations distinguish exact paths and globs with evidence", () => {
	const files = intelligence().queryFiles({ nodeIds: ["application:desktop"] }).files;
	assert.deepEqual(
		files.map(({ path, match }) => ({ path, match })),
		[
			{ path: "apps/desktop/src/**", match: "glob" },
			{ path: "apps/desktop/src/main.ts", match: "exact" },
		],
	);
	assert.equal(files[0].ownerId, "application:desktop/process:main");
	assert.equal(files[0].relationship, "composed-child");
	assert.equal(files[0].confidence, "declared");
	assert.ok(files[0].evidence.length);
});

test("node descriptions expose safe normalized provider metadata", () => {
	const metadata = intelligence().describeNode("application:desktop/process:main").providerMetadata;
	assert.equal(metadata.command, "electron");
	assert.equal(metadata.runtimeId, "node");
	assert.deepEqual(metadata.arguments, ["."]);
	assert.deepEqual(metadata.urls, ["http://127.0.0.1:3316"]);
	assert.deepEqual(metadata.ports, [3316]);
	assert.deepEqual(metadata.environmentVariableNames, ["RENDERER_URL"]);
	assert.deepEqual(metadata.entrypoints, ["apps/desktop/src/main.ts"]);
	assert.equal(JSON.stringify(metadata).includes("secret"), false);
});

test("reverse lookup normalizes separators and rejects escaping paths", () => {
	const result = intelligence().queryFiles({ paths: ["apps\\desktop\\src\\view.ts"] });
	assert.equal(result.files[0].path, "apps/desktop/src/view.ts");
	assert.equal(result.files[0].match, "exact");
	assert.throws(() => intelligence().queryFiles({ paths: ["../outside.ts"] }), {
		code: "query.path_invalid",
	});
});

test("empty file results explain missing owners, roles, and paths", () => {
	const service = intelligence();
	assert.equal(
		service.queryFiles({ nodeIds: ["application:missing"] }).warnings[0].code,
		"workspace.owner_not_found",
	);
	assert.equal(
		service.queryFiles({ nodeIds: ["application:desktop"], roles: ["test"] }).warnings[0].code,
		"workspace.role_unmatched",
	);
	assert.equal(
		service.queryFiles({ paths: ["unknown.ts"] }).warnings[0].code,
		"workspace.path_unowned",
	);
});

test("impact includes a contained process's parent application", () => {
	assert.deepEqual(
		intelligence()
			.analyzeChangeImpact({ paths: ["apps/desktop/src/main.ts"] })
			.affectedNodes.map(({ id }) => id),
		["application:desktop", "application:desktop/process:main"],
	);
});

test("application command plans use the lifecycle start closure", () => {
	const plan = intelligence().planCommand({
		type: "node.start",
		nodeIds: ["application:desktop"],
	});
	assert.deepEqual(plan.affectedProcesses, [
		"application:desktop",
		"application:desktop/process:main",
	]);
	assert.deepEqual(plan.dependencyActions, [
		{ action: "start", target: "application:desktop/process:main" },
	]);
});

test("ownership index is reused within a revision and invalidated on revision change", async () => {
	let revision = 4;
	let resolutions = 0;
	const normalized = normalizeSystemDefinition(
		{
			name: "revisioned",
			services: { web: { provider: { provider: "fixture" } } },
		},
		{ root: "/workspace", file: "/workspace/wsrt.config.ts" },
	);
	const service = new DefaultWorkspaceIntelligence({
		workspaceId: "revisioned",
		definition: normalized.definition,
		graph: compileSystemGraph(normalized.definition),
		snapshot: () => ({ ...live, revision }),
		contributions: [
			{
				id: "fixture-ownership",
				owner: { id: "fixture", version: "1.0.0" },
				category: "source-ownership",
				facts: [
					{
						type: "source-ownership",
						selector: { provider: "fixture" },
						resolve: () => {
							resolutions += 1;
							return [{ pattern: "src/**", role: "source" }];
						},
					},
				],
			},
		],
	});
	await Promise.all([
		Promise.resolve(service.queryFiles({ paths: ["src/a.ts"] })),
		Promise.resolve(service.queryFiles({ paths: ["src/b.ts"] })),
	]);
	assert.equal(resolutions, 1);
	revision = 5;
	service.queryFiles({ paths: ["src/c.ts"] });
	assert.equal(resolutions, 2);
});

test("validation recommendations are deterministic and topologically ordered", () => {
	const normalized = normalizeSystemDefinition(
		{
			name: "validation",
			tasks: {
				typecheck: { inputs: ["src/**"] },
				build: { dependsOn: ["typecheck"] },
				test: { dependsOn: ["build"] },
				validate: { dependsOn: ["test"] },
			},
		},
		{ root: "/workspace", file: "/workspace/wsrt.config.ts" },
	);
	const service = new DefaultWorkspaceIntelligence({
		workspaceId: "validation",
		definition: normalized.definition,
		graph: compileSystemGraph(normalized.definition),
		snapshot: () => live,
	});
	const result = service.recommendValidation({ paths: ["src/main.ts"] });
	assert.deepEqual(
		result.recommendations.map(({ taskId }) => taskId),
		["task:typecheck", "task:build", "task:test", "task:validate"],
	);
	assert.deepEqual(result.recommendations.at(-1).coveredTaskIds, [
		"task:build",
		"task:test",
		"task:typecheck",
	]);
	assert.ok(result.recommendations.every(({ evidence, reason }) => evidence.length && reason));
});
