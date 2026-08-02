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
	assert.deepEqual(files[0].contributionSources, ["wsrt-config"]);
	assert.equal(JSON.stringify(files).includes("processs."), false);
	assert.ok(
		files[0].evidence.some(({ reason }) => reason.includes("applications.desktop.processes.main")),
	);
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

test("aggregate node descriptions preserve child facts and original owners", () => {
	const direct = intelligence().describeNode("application:desktop");
	assert.equal(direct.includedNodes, undefined);
	const aggregate = intelligence().describeNode("application:desktop", {
		aggregate: true,
		depth: 1,
	});
	assert.deepEqual(aggregate.aggregation.includedNodeIds, ["application:desktop/process:main"]);
	assert.deepEqual(aggregate.aggregation.originalOwnerIds, ["application:desktop/process:main"]);
	assert.deepEqual(aggregate.includedNodes[0].providerMetadata.entrypoints, [
		"apps/desktop/src/main.ts",
	]);
	assert.equal(aggregate.includedRelationships[0].kind, "contains");
});

test("node discovery exposes canonical IDs and suggests them for guessed shorthand", () => {
	const service = intelligence();
	const child = service
		.queryNodes({ kinds: ["process"] })
		.nodes.find(({ id }) => id === "application:desktop/process:main");
	assert.deepEqual(child.aliases, []);
	assert.equal(child.parentId, "application:desktop");
	assert.throws(() => service.describeNode("process:desktop/main"), {
		code: "workspace.node_not_found",
		details: {
			requested: "process:desktop/main",
			suggestions: ["application:desktop/process:main", "application:desktop", "workspace:files"],
		},
	});
	assert.throws(() => service.describeNode("process:desktop/mian"), {
		code: "workspace.node_not_found",
		details: {
			requested: "process:desktop/mian",
			suggestions: ["application:desktop/process:main", "application:desktop", "workspace:files"],
		},
	});
});

test("get-started teaches a vendor-neutral WSRT-first workflow", () => {
	const result = intelligence().getStarted();
	assert.equal(result.workspace.id, "files");
	assert.ok(result.importantNodeIds.includes("application:desktop"));
	assert.equal(result.recommendedCalls.length, 10);
	assert.equal(result.recommendedCalls[0].operation, "workspace.capabilities");
	assert.equal(result.recommendedCalls[3].arguments.nodeId, "application:desktop");
	assert.match(result.querySemantics.nodeDescriptions, /Direct by default/);
	assert.ok(result.availableAdapters.includes("programmatic"));
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
			.entities.map(({ id }) => id),
		["application:desktop", "application:desktop/process:main"],
	);
});

test("application command plans use the lifecycle start closure", () => {
	const plan = intelligence().planCommand({
		type: "node.start",
		nodeIds: ["application:desktop"],
	});
	assert.deepEqual(plan.requestedTargets, ["application:desktop"]);
	assert.deepEqual(plan.expandedTargets, ["application:desktop/process:main"]);
	assert.deepEqual(plan.executionOrder, ["start:application:desktop/process:main"]);
	assert.deepEqual(plan.affectedNodes, ["application:desktop", "application:desktop/process:main"]);
	assert.deepEqual(plan.affectedProcesses, ["application:desktop/process:main"]);
	assert.deepEqual(plan.actions, [
		{
			id: "start:application:desktop/process:main",
			action: "start",
			target: "application:desktop/process:main",
			prerequisite: true,
		},
	]);
});

test("ownership index is reused within a revision and invalidated on revision change", async () => {
	let revision = 4;
	let resolutions = 0;
	const normalized = normalizeSystemDefinition(
		{
			name: "revisioned",
			services: { web: { provider: { provider: "fixture" }, sources: ["src/**"] } },
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
	assert.deepEqual(service.queryFiles({ paths: ["src/c.ts"] }).files[0].contributionSources, [
		"fixture-ownership",
		"wsrt-config",
	]);
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
	assert.ok(
		result.recommendations.every(({ evidenceIds, reason }) => evidenceIds.length && reason),
	);
	const referencedEvidence = result.recommendations.flatMap(({ evidenceIds }) => evidenceIds);
	assert.ok(referencedEvidence.every((id) => result.evidence.records[id]));
	assert.equal(Object.keys(result.evidence.records).length, new Set(referencedEvidence).size);
});
