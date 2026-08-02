import assert from "node:assert/strict";
import test from "node:test";
import {
	validateRequestEnvelope,
	WORKSPACE_PROTOCOL_VERSION,
} from "../packages/workspace-session/dist/index.js";

const envelope = (request) => ({
	protocolVersion: WORKSPACE_PROTOCOL_VERSION,
	requestId: "request-1",
	request,
});

test("workspace protocol v2 validates transport-neutral intelligence operations", () => {
	assert.deepEqual(validateRequestEnvelope(envelope({ type: "workspace.capabilities" })).request, {
		type: "workspace.capabilities",
	});
	assert.deepEqual(validateRequestEnvelope(envelope({ type: "workspace.get-started" })).request, {
		type: "workspace.get-started",
	});
	assert.deepEqual(
		validateRequestEnvelope(
			envelope({
				type: "workspace.node.describe",
				nodeId: "application:desktop",
				options: { aggregate: true, depth: 2 },
			}),
		).request,
		{
			type: "workspace.node.describe",
			nodeId: "application:desktop",
			options: { aggregate: true, depth: 2 },
		},
	);
	assert.deepEqual(
		validateRequestEnvelope(
			envelope({ type: "workspace.nodes.query", query: { kinds: ["process"], limit: 10 } }),
		).request,
		{ type: "workspace.nodes.query", query: { kinds: ["process"], limit: 10 } },
	);
	assert.deepEqual(
		validateRequestEnvelope(
			envelope({
				type: "workspace.graph.query",
				query: { roots: ["application:web"], direction: "dependencies", depth: 2, limit: 50 },
				expectedRevision: 7,
			}),
		).request,
		{
			type: "workspace.graph.query",
			query: { roots: ["application:web"], direction: "dependencies", depth: 2, limit: 50 },
			expectedRevision: 7,
		},
	);
	assert.deepEqual(
		validateRequestEnvelope(
			envelope({
				type: "workspace.validation.recommend",
				query: { paths: ["src/main.ts"] },
			}),
		).request,
		{ type: "workspace.validation.recommend", query: { paths: ["src/main.ts"] } },
	);
	assert.deepEqual(
		validateRequestEnvelope(envelope({ type: "workspace.file.owners", path: "src/main.ts" }))
			.request,
		{ type: "workspace.file.owners", path: "src/main.ts" },
	);
	assert.deepEqual(
		validateRequestEnvelope(
			envelope({
				type: "workspace.change.impact",
				query: { paths: ["src/main.ts"], expand: ["nodes", "evidence"] },
			}),
		).request,
		{
			type: "workspace.change.impact",
			query: { paths: ["src/main.ts"], expand: ["nodes", "evidence"] },
		},
	);
	assert.deepEqual(
		validateRequestEnvelope(
			envelope({
				type: "workspace.command.plan",
				command: { type: "node.start", nodeIds: ["application:web"] },
				permissions: ["commands.plan"],
			}),
		).request,
		{
			type: "workspace.command.plan",
			command: { type: "node.start", nodeIds: ["application:web"] },
			permissions: ["commands.plan"],
		},
	);
	assert.deepEqual(
		validateRequestEnvelope(
			envelope({
				type: "workspace.files.query",
				query: {
					nodeIds: ["application:web"],
					taskIds: ["build"],
					roles: ["source"],
					includeGenerated: false,
					aggregate: true,
					limit: 25,
				},
			}),
		).request.query,
		{
			nodeIds: ["application:web"],
			taskIds: ["build"],
			roles: ["source"],
			includeGenerated: false,
			aggregate: true,
			limit: 25,
		},
	);
});

test("workspace protocol v2 rejects malformed requests", () => {
	for (const request of [
		{ type: "workspace.node.describe", nodeId: "" },
		{ type: "workspace.node.describe", nodeId: "application:desktop", options: { depth: 0 } },
		{ type: "workspace.graph.query", query: { roots: "application:web" } },
		{ type: "workspace.nodes.query", query: { kinds: "process" } },
		{ type: "workspace.graph.query", query: { roots: [], direction: "sideways" } },
		{ type: "workspace.files.query", query: { roles: [1] } },
		{ type: "workspace.describe", expectedRevision: -1 },
		{ type: "workspace.change.impact", query: { paths: [] } },
		{ type: "workspace.change.impact", query: { paths: ["src/main.ts"], expand: ["unknown"] } },
		{ type: "workspace.command.plan", command: { type: "shell", command: "rm" } },
		{
			type: "workspace.command.execute",
			command: { type: "task.run", taskId: "build" },
			permissions: ["shell.execute"],
		},
	])
		assert.throws(() => validateRequestEnvelope(envelope(request)), {
			code: "protocol.malformed_request",
		});
});
