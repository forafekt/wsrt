import assert from "node:assert/strict";
import test from "node:test";
import {
	evidenceTypes,
	WORKSPACE_INTELLIGENCE_SCHEMA_VERSION,
	workspaceFileRoles,
} from "../packages/workspace-intelligence/dist/index.js";

test("workspace intelligence contract exposes stable JSON-safe vocabularies", () => {
	assert.equal(WORKSPACE_INTELLIGENCE_SCHEMA_VERSION, "1");
	assert.deepEqual(JSON.parse(JSON.stringify(evidenceTypes)), [
		"configuration",
		"plugin",
		"manifest",
		"runtime",
		"workspace",
		"derived",
	]);
	assert.deepEqual(workspaceFileRoles, [
		"source",
		"entrypoint",
		"configuration",
		"test",
		"generated",
		"task-input",
		"task-output",
		"artifact",
		"manifest",
	]);
	assert.ok(Object.isFrozen(evidenceTypes));
	assert.ok(Object.isFrozen(workspaceFileRoles));
});
