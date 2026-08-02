import assert from "node:assert/strict";
import test from "node:test";
import { compileSystemGraph, normalizeSystemDefinition } from "../packages/config/dist/index.js";
import { DefaultWorkspaceIntelligence } from "../packages/workspace-intelligence/dist/index.js";

const live = {
	revision: 3,
	generatedAt: "2026-08-02T12:00:00.000Z",
	workspace: { name: "owned", root: "/workspace" },
	nodes: [],
	operations: [],
	artifacts: [],
	diagnostics: [],
	events: { size: 0 },
	plugins: [],
	providers: [],
};

test("normalizes source ownership and supports forward and reverse lookup", () => {
	const normalized = normalizeSystemDefinition(
		{
			name: "owned",
			applications: {
				web: {
					sources: ["apps/web/src/**"],
					entrypoints: ["apps/web/src/main.ts"],
					configuration: ["apps/web/vite.config.ts"],
					tests: ["apps/web/tests/**"],
					generated: ["apps/web/generated/**"],
				},
			},
			tasks: {
				build: {
					inputs: ["apps/web/src/**", "packages/*/src/**", "tsconfig.json"],
					outputs: [{ artifact: "bundle", path: "dist/**" }],
				},
			},
			artifacts: { bundle: { type: "directory", producer: "build" } },
		},
		{ root: "/workspace", file: "/workspace/wsrt.config.ts" },
	);
	assert.deepEqual(normalized.diagnostics, []);
	const definition = normalized.definition;
	assert.deepEqual(
		definition.executables
			.find(({ id }) => id === "application:web")
			.files.map(({ pattern, role }) => ({ pattern, role })),
		[
			{ pattern: "apps/web/generated/**", role: "generated" },
			{ pattern: "apps/web/src/**", role: "source" },
			{ pattern: "apps/web/src/main.ts", role: "entrypoint" },
			{ pattern: "apps/web/tests/**", role: "test" },
			{ pattern: "apps/web/vite.config.ts", role: "configuration" },
		],
	);
	const intelligence = new DefaultWorkspaceIntelligence({
		workspaceId: "owned-1",
		definition,
		graph: compileSystemGraph(definition),
		snapshot: () => live,
	});
	assert.deepEqual(
		intelligence
			.queryFiles({ nodeIds: ["application:web"], roles: ["source"] })
			.files.map(({ path }) => path),
		["apps/web/src/**"],
	);
	assert.deepEqual(
		intelligence
			.queryFiles({ paths: ["apps/web/src/view.ts"] })
			.files.map(({ owners, path }) => ({ owners, path })),
		[
			{ owners: ["application:web"], path: "apps/web/src/view.ts" },
			{ owners: ["task:build"], path: "apps/web/src/view.ts" },
		],
	);
	assert.deepEqual(intelligence.queryFiles({ paths: ["apps/web/generated/types.ts"] }).files, []);
	assert.equal(
		intelligence.queryFiles({ paths: ["apps/web/generated/types.ts"], includeGenerated: true })
			.files[0].generated,
		true,
	);
	const impact = intelligence.analyzeChangeImpact({ paths: ["apps/web/src/view.ts"] });
	assert.equal(impact.confidence, "declared");
	assert.deepEqual(
		impact.affectedNodes.map(({ id }) => id),
		["application:web", "artifact:bundle", "task:build"],
	);
	assert.deepEqual(impact.directOwnerIds, ["application:web", "task:build"]);
	assert.deepEqual(
		impact.affectedArtifacts.map(({ id }) => id),
		["artifact:bundle"],
	);
	assert.deepEqual(impact.recommendedValidations, ["task:build"]);
	assert.ok(impact.evidence.some(({ reason }) => /declared source ownership/.test(reason)));
	assert.equal(intelligence.analyzeChangeImpact({ paths: ["unknown.txt"] }).confidence, "unknown");
	const taskFiles = intelligence.queryFiles({ taskIds: ["build"], includeGenerated: true }).files;
	assert.ok(taskFiles.some(({ role, path }) => role === "task-input" && path === "tsconfig.json"));
	assert.ok(
		taskFiles.some(({ role, producerId }) => role === "task-output" && producerId === "task:build"),
	);
	const artifactFiles = intelligence.queryFiles({
		artifactIds: ["bundle"],
		includeGenerated: true,
	}).files;
	assert.deepEqual(
		artifactFiles.map(({ ownerId, path, producerId }) => ({ ownerId, path, producerId })),
		[{ ownerId: "artifact:bundle", path: "dist/**", producerId: "task:build" }],
	);
	assert.deepEqual(intelligence.describeNode("task:build").artifacts, ["artifact:bundle"]);
});

test("rejects ownership paths that escape the workspace", () => {
	const result = normalizeSystemDefinition(
		{ name: "invalid", services: { api: { sources: ["../secret/**"] } } },
		{ root: "/workspace", file: "/workspace/wsrt.yml" },
	);
	assert.equal(result.definition, undefined);
	assert.equal(result.diagnostics[0].code, "config.invalid_type");
});
