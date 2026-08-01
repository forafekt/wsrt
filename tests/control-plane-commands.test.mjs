import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	ControlPlaneError,
	createControlPlane,
	serializeControlPlaneError,
} from "@wsrt/control-plane";
import { startDashboard } from "@wsrt/plugin-dashboard";

test("explicit commands preserve node and task semantics", async () => {
	const root = await fixture();
	const plane = await createControlPlane({ root, persistence: false });
	try {
		const started = await plane.execute({ type: "node.start", nodeIds: ["application:desktop"] });
		assert.equal(started.status, "completed");
		assert.equal(started.states["application:desktop"], "ready");

		await assert.rejects(
			plane.execute({ type: "task.run", taskId: "application:desktop" }),
			(cause) => {
				assert.ok(cause instanceof ControlPlaneError);
				assert.deepEqual(serializeControlPlaneError(cause), {
					code: "selector.kind_mismatch",
					message: 'Expected task "application:desktop", but application:desktop is an application',
					details: {
						value: "application:desktop",
						expectedKind: "task",
						actualKind: "application",
						resolvedId: "application:desktop",
					},
				});
				return true;
			},
		);

		await assert.rejects(
			plane.execute({ type: "node.start", nodeIds: ["shared"] }),
			(cause) => cause instanceof ControlPlaneError && cause.code === "selector.ambiguous",
		);
	} finally {
		await plane.dispose();
		await fs.rm(root, { recursive: true, force: true });
	}
});

test("dashboard returns command errors without terminating its worker", async () => {
	const root = await fixture();
	const plane = await createControlPlane({ root, persistence: false });
	const dashboard = await startDashboard(plane, { port: 0, strictPort: false, basePath: "/" });
	try {
		const invalid = await fetch(
			`${dashboard.url}api/tasks/${encodeURIComponent("application:desktop")}/run`,
			{ method: "POST" },
		);
		assert.equal(invalid.status, 409);
		const failure = await invalid.json();
		assert.match(failure.error.message, /is an application/);

		const started = await fetch(
			`${dashboard.url}api/nodes/${encodeURIComponent("application:desktop")}/start`,
			{ method: "POST" },
		);
		assert.equal(started.status, 202);
		assert.ok((await started.json()).operationId);
		assert.equal((await fetch(`${dashboard.url}api/snapshot`)).status, 200);
	} finally {
		await dashboard.close();
		await plane.dispose();
		await fs.rm(root, { recursive: true, force: true });
	}
});

async function fixture() {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "wsrt-commands-"));
	await fs.writeFile(
		path.join(root, "wsrt.json"),
		JSON.stringify({
			schemaVersion: "1",
			name: "commands",
			applications: { desktop: {}, shared: {} },
			services: { shared: {} },
			tasks: { build: {} },
		}),
	);
	return root;
}
