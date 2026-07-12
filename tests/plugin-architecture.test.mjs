import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { PluginSession, resolveWorkspacePlugins } from "@wsrt/plugins";

test("core packages do not depend on or import the dashboard plugin", () => {
	for (const name of ["cli", "config", "control-plane", "plugins"]) {
		const root = new URL(`../packages/${name}/`, import.meta.url),
			manifest = JSON.parse(
				fs.readFileSync(new URL("package.json", root), "utf8"),
			);
		assert.equal(manifest.dependencies?.["@wsrt/plugin-dashboard"], undefined);
		for (const file of fs.readdirSync(new URL("src", root)))
			if (file.endsWith(".ts"))
				assert.doesNotMatch(
					fs.readFileSync(new URL(`src/${file}`, root), "utf8"),
					/@wsrt\/plugin-dashboard/,
				);
	}
});

test("configured plugins resolve from the workspace without implicit injection", async () => {
	const plugins = await resolveWorkspacePlugins(
		[{ provider: "@wsrt/plugin-dashboard", options: { port: 0 } }],
		new URL("..", import.meta.url).pathname,
	);
	const session = new PluginSession(plugins);
	assert.equal(
		session.executable("dashboard")?.owner.id,
		"@wsrt/plugin-dashboard",
	);
	assert.deepEqual(new PluginSession([]).executables(), []);
});

test("missing plugin resolution includes installation guidance", async () => {
	await assert.rejects(
		resolveWorkspacePlugins(
			["@wsrt/plugin-does-not-exist"],
			new URL("..", import.meta.url).pathname,
		),
		/WSRT_PLUGIN_PACKAGE_NOT_FOUND[\s\S]*pnpm add -D/,
	);
});
