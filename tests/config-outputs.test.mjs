import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSystemDefinition } from "@wsrt/config";

test("task outputs reject producer mismatch, duplicates and workspace escapes", () => {
	const result = normalizeSystemDefinition(
		{
			name: "outputs",
			tasks: {
				build: {
					command: "true",
					outputs: [
						{ artifact: "result", path: "../escape" },
						{ artifact: "result", path: "out.txt" },
					],
				},
			},
			artifacts: { result: { type: "file", producer: "other" } },
		},
		{ root: "/workspace", file: "/workspace/wsrt.config.ts" },
	);
	const codes = result.diagnostics.map((item) => item.code);
	assert.ok(codes.includes("WSRT_ARTIFACT_PRODUCER_MISMATCH"));
	assert.ok(codes.includes("config.artifact_output_duplicate"));
	assert.ok(codes.includes("WSRT_ARTIFACT_PATH_INVALID"));
});
