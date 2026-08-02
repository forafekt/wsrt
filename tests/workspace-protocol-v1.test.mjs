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

test("workspace protocol v1 validates transport-neutral intelligence operations", () => {
	assert.deepEqual(validateRequestEnvelope(envelope({ type: "workspace.capabilities" })).request, {
		type: "workspace.capabilities",
	});
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
			envelope({ type: "workspace.change.impact", query: { paths: ["src/main.ts"] } }),
		).request,
		{ type: "workspace.change.impact", query: { paths: ["src/main.ts"] } },
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

test("workspace protocol v1 rejects malformed requests", () => {
	for (const request of [
		{ type: "workspace.node.describe", nodeId: "" },
		{ type: "workspace.graph.query", query: { roots: "application:web" } },
		{ type: "workspace.graph.query", query: { roots: [], direction: "sideways" } },
		{ type: "workspace.files.query", query: { roles: [1] } },
		{ type: "workspace.describe", expectedRevision: -1 },
		{ type: "workspace.change.impact", query: { paths: [] } },
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
