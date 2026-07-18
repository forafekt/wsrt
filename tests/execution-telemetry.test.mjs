import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import {
	cleanupStaleExecutionState,
	createEnvelope,
	createOwnedExecutionState,
	ExecutionTelemetryReader,
	maximumTelemetryRecordBytes,
	removeOwnedExecutionState,
} from "../plugins/vite/dist/telemetry.js";

async function append(state, value, newline = true) {
	await fs.appendFile(
		state.telemetryFile,
		`${typeof value === "string" ? value : JSON.stringify(value)}${newline ? "\n" : ""}`,
	);
}

test("telemetry reader validates attribution, order, malformed records and partial writes", async () => {
	const state = createOwnedExecutionState();
	const reader = new ExecutionTelemetryReader(
		state.telemetryFile,
		state.executionId,
		3,
	);
	try {
		await append(
			state,
			createEnvelope(state.executionId, 1, { type: "execution.started" }),
		);
		await append(state, "{bad");
		await append(
			state,
			createEnvelope("another", 2, { type: "readiness.available" }),
		);
		await append(
			state,
			createEnvelope(state.executionId, 1, { type: "readiness.available" }),
		);
		const second = createEnvelope(state.executionId, 2, {
			type: "server.listening",
			host: "127.0.0.1",
			port: 0,
		});
		const serialized = JSON.stringify(second);
		await append(state, serialized.slice(0, 20), false);
		let result = await reader.read();
		assert.deepEqual(
			result.records.map((item) => item.sequence),
			[1],
		);
		assert.deepEqual(
			result.issues.map((item) => item.code),
			[
				"WSRT_TELEMETRY_MALFORMED_RECORD",
				"WSRT_TELEMETRY_EXECUTION_MISMATCH",
				"WSRT_TELEMETRY_SEQUENCE_INVALID",
			],
		);
		await append(state, serialized.slice(20));
		result = await reader.read();
		assert.deepEqual(
			result.records.map((item) => item.sequence),
			[2],
		);
		assert.equal(result.records[0].event.port, 0);
		assert.equal((await reader.close({ drain: true })).length, 0);
		assert.equal(reader.state, "closed");
		assert.deepEqual(await reader.read(), { records: [], issues: [] });
	} finally {
		await removeOwnedExecutionState(state);
	}
});

test("telemetry rejects invalid payloads, versions, oversized records, and bounds floods", async () => {
	const state = createOwnedExecutionState();
	const reader = new ExecutionTelemetryReader(
		state.telemetryFile,
		state.executionId,
		2,
	);
	try {
		await append(state, { version: 1, event: { type: "readiness.available" } });
		await append(state, {
			...createEnvelope(state.executionId, 1, { type: "readiness.available" }),
			version: 99,
		});
		await append(
			state,
			createEnvelope(state.executionId, 1, {
				type: "server.listening",
				host: "x",
				port: 70_000,
			}),
		);
		await append(state, "x".repeat(maximumTelemetryRecordBytes + 1));
		await append(state, "bad");
		const result = await reader.read();
		assert.equal(result.records.length, 0);
		assert.equal(result.issues.length, 2);
		assert.ok(
			result.issues.every((item) => item.code.startsWith("WSRT_TELEMETRY_")),
		);
	} finally {
		await removeOwnedExecutionState(state);
	}
});

test("owned telemetry state is collision-resistant and cleanup is ownership checked", async () => {
	const states = Array.from({ length: 20 }, () => createOwnedExecutionState());
	try {
		assert.equal(
			new Set(states.map((item) => item.directory)).size,
			states.length,
		);
		const modes = await Promise.all(
			states.map((item) => fs.stat(item.telemetryFile)),
		);
		assert.ok(modes.every((item) => (item.mode & 0o077) === 0));
		const candidates = cleanupStaleExecutionState({
			minimumAgeMs: 0,
			dryRun: true,
		});
		assert.ok(states.every((state) => !candidates.includes(state.directory)));
	} finally {
		await Promise.all(states.map(removeOwnedExecutionState));
	}
});

test("stale recovery removes only old, owned, inactive execution state", async () => {
	const stale = createOwnedExecutionState();
	await fs.writeFile(
		stale.manifestFile,
		JSON.stringify({
			protocol: "wsrt.execution-telemetry",
			version: 1,
			executionId: stale.executionId,
			pid: 2_147_483_647,
			createdAt: "2000-01-01T00:00:00.000Z",
		}),
	);
	const dry = cleanupStaleExecutionState({ minimumAgeMs: 1, dryRun: true });
	assert.ok(dry.includes(stale.directory));
	cleanupStaleExecutionState({ minimumAgeMs: 1 });
	await assert.rejects(fs.access(stale.directory));
});
