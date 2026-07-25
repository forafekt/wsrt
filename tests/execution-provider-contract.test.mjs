import assert from "node:assert/strict";
import test from "node:test";
import { exerciseExecutionAdapterContract } from "../packages/capabilities/dist/testing.js";
import { viteAdapter } from "../plugins/vite/dist/adapter.js";

test("Vite satisfies the reusable execution-adapter contract", async () => {
	const result = await exerciseExecutionAdapterContract(viteAdapter, {
		validOptions: {
			command: "build",
			args: ["--mode", "test"],
			host: "127.0.0.1",
			port: 4173,
		},
		invalidOptions: "invalid",
		executionId: (metadata) => metadata?.executionState?.executionId,
	});
	assert.equal(result.id, "vite");
	assert.match(result.arguments[0], /vite\.js$/);
	assert.deepEqual(result.arguments.slice(1), [
		"build",
		"--mode",
		"test",
		"--host",
		"127.0.0.1",
		"--port",
		"4173",
		"--strictPort",
	]);
	assert.notEqual(...result.concurrentExecutionIds);
});
test("Vite build adapters declare exit-based completion", () => {
	const validation = viteAdapter.validate({ command: "build" });
	assert.equal(viteAdapter.prepare(validation.options).completion, "exit");
});
