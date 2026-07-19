import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createWsrtCli } from "../packages/cli/dist/cli.js";
import { createControlPlane } from "../packages/control-plane/dist/index.js";
import {
	definePlugin,
	orderPlugins,
	PluginLifecycleError,
	PluginResolutionError,
	PluginSession,
	resolveWorkspacePlugins,
	resolveWorkspacePluginsReport,
} from "../packages/plugins/dist/index.js";

const context = () => ({
	root: "/workspace",
	configuration: {},
	logger: { info() {}, warn() {}, error() {} },
	diagnostics: { add() {} },
	events: { emit() {} },
	services: {},
});

test("plugins are ordered deterministically with required dependencies", () => {
	const core = definePlugin({ id: "core", version: "1.2.0" });
	const feature = definePlugin({
		id: "feature",
		version: "2.0.0",
		requires: [{ id: "core", minVersion: "1.1.0", maxVersion: "1.9.0" }],
	});
	assert.deepEqual(
		orderPlugins([feature, core]).map((item) => item.id),
		["core", "feature"],
	);
});

test("duplicates, missing dependencies, cycles, versions, and incompatibilities are rejected", () => {
	assert.throws(
		() =>
			orderPlugins([
				{ id: "a", version: "1.0.0" },
				{ id: "a", version: "1.0.1" },
			]),
		(error) => error instanceof PluginResolutionError && error.code === "plugin.duplicate",
	);
	assert.throws(
		() => orderPlugins([{ id: "a", version: "1.0.0", requires: ["missing"] }]),
		/requires missing plugin/,
	);
	assert.throws(
		() =>
			orderPlugins([
				{ id: "a", version: "1.0.0", requires: ["b"] },
				{ id: "b", version: "1.0.0", requires: ["a"] },
			]),
		/cycle/,
	);
	assert.throws(
		() =>
			orderPlugins([
				{ id: "core", version: "1.0.0" },
				{
					id: "feature",
					version: "1.0.0",
					requires: [{ id: "core", minVersion: "2.0.0" }],
				},
			]),
		(error) => error.code === "plugin.version_mismatch",
	);
	assert.throws(
		() =>
			orderPlugins([
				{ id: "a", version: "1.0.0", incompatible: ["b"] },
				{ id: "b", version: "1.0.0" },
			]),
		(error) => error.code === "plugin.incompatible",
	);
});

test("lifecycle follows dependency order and disposes in reverse order", async () => {
	const calls = [];
	const plugin = (id, requires = []) =>
		definePlugin({
			id,
			version: "1.0.0",
			requires,
			lifecycle: Object.fromEntries(
				["discover", "configure", "workspace", "graph", "providers", "runtime", "shutdown"].map(
					(stage) => [stage, () => calls.push(`${stage}:${id}`)],
				),
			),
			dispose: () => calls.push(`dispose:${id}`),
		});
	const session = new PluginSession([plugin("feature", ["core"]), plugin("core")]);
	await session.initialize(context());
	await session.dispose(context());
	assert.deepEqual(calls.slice(0, 2), ["discover:core", "discover:feature"]);
	assert.deepEqual(calls.slice(-4), [
		"shutdown:feature",
		"dispose:feature",
		"shutdown:core",
		"dispose:core",
	]);
});

test("lifecycle failures are attributed and reflected in snapshots", async () => {
	const session = new PluginSession([
		definePlugin({
			id: "broken",
			version: "1.0.0",
			lifecycle: {
				configure() {
					throw new Error("bad setup");
				},
			},
		}),
	]);
	await assert.rejects(
		session.initialize(context()),
		(error) =>
			error instanceof PluginLifecycleError &&
			error.plugin === "broken" &&
			error.stage === "configure",
	);
	assert.equal(session.snapshots()[0].state, "failed");
	assert.equal(session.snapshots()[0].diagnostics[0].code, "plugin.lifecycle_failed");
});

test("typed registries expose contributions and snapshots without implementations", () => {
	const owner = { id: "tooling", version: "1.0.0" };
	const session = new PluginSession([
		definePlugin({
			...owner,
			contributions: {
				cli: [
					{
						id: "hello",
						path: "hello",
						description: "Hello",
						owner,
						run() {
							return "hello";
						},
					},
				],
				configuration: [{ id: "tooling", validate: () => [] }],
				dashboard: [{ id: "home", kind: "page" }],
			},
		}),
	]);
	assert.equal(session.contributions("cli")[0].path, "hello");
	assert.deepEqual(session.snapshots()[0].capabilities, ["cli", "configuration", "dashboard"]);
	assert.deepEqual(session.snapshots()[0].registrations.dashboard, ["home"]);
});

test("explicit package and local-file discovery are deterministic and failures are reported", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "wsrt-plugin-"));
	await fs.writeFile(path.join(root, "package.json"), '{"type":"module"}');
	await fs.writeFile(
		path.join(root, "local.mjs"),
		'export default (options) => ({ id: "local", version: options.version })',
	);
	const loaded = await resolveWorkspacePlugins(
		[{ provider: "./local.mjs", options: { version: "1.0.0" } }],
		root,
	);
	assert.equal(loaded[0].id, "local");
	const report = await resolveWorkspacePluginsReport(["./missing.mjs"], root);
	assert.equal(report.plugins.length, 0);
	assert.equal(report.diagnostics[0].plugin, "./missing.mjs");
	const direct = definePlugin({ id: "direct", version: "1.0.0" });
	assert.equal((await resolveWorkspacePlugins([direct], root))[0], direct);
});

test("plugin CLI contributions become natural top-level commands", async () => {
	const original = process.argv;
	let received;
	const owner = { id: "cli-plugin", version: "1.0.0" };
	const contribution = {
		id: "greet",
		path: "greet",
		description: "Greet someone",
		owner,
		run(_context, args) {
			received = args;
			return { greeted: args[0] };
		},
	};
	process.argv = ["node", "wsrt", "greet", "Ada"];
	try {
		await createWsrtCli([contribution]).parseAsync(process.argv);
	} finally {
		process.argv = original;
	}
	assert.deepEqual(received, ["Ada"]);
});

test("control-plane validates plugin configuration and exposes public plugin snapshots", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "wsrt-plugin-plane-"));
	await fs.writeFile(path.join(root, "package.json"), '{"type":"module"}');
	await fs.writeFile(
		path.join(root, "plugin.mjs"),
		`export default (options) => ({ id: "fixture", name: "Fixture", version: "1.2.3", contributions: { configuration: [{ id: "./plugin.mjs", validate: () => options.valid ? [] : [{ code: "fixture.invalid", severity: "error", message: "invalid fixture options" }] }] } })`,
	);
	await fs.writeFile(
		path.join(root, "wsrt.json"),
		JSON.stringify({
			name: "fixture",
			plugins: [{ provider: "./plugin.mjs", options: { valid: true } }],
		}),
	);
	const plane = await createControlPlane({ root });
	try {
		const snapshot = plane.snapshot().plugins[0];
		assert.equal(snapshot.id, "fixture");
		assert.equal(snapshot.version, "1.2.3");
		assert.equal(snapshot.state, "running");
		assert.deepEqual(snapshot.registrations.configuration, ["./plugin.mjs"]);
	} finally {
		await plane.dispose();
	}
	await fs.writeFile(
		path.join(root, "wsrt.json"),
		JSON.stringify({
			name: "fixture",
			plugins: [{ provider: "./plugin.mjs", options: { valid: false } }],
		}),
	);
	await assert.rejects(createControlPlane({ root }), /invalid fixture options/);
});
