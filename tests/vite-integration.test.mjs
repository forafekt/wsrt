import assert from "node:assert/strict";
import test from "node:test";
import { forwardedArguments } from "../packages/cli/dist/executable.js";
import { mergeAliases } from "../plugins/vite/dist/aliases.js";
import vitePlugin, { createViteAdapter, viteAdapter } from "../plugins/vite/dist/index.js";
import { wsrt } from "../plugins/vite/dist/vite.js";

test("Vite CLI arguments are forwarded losslessly with or without separator", () => {
	assert.deepEqual(
		forwardedArguments(["node", "wsrt", "exec", "vite", "dev", "--host", "0.0.0.0"], "vite"),
		["dev", "--host", "0.0.0.0"],
	);
	assert.deepEqual(
		forwardedArguments(
			["node", "wsrt", "exec", "vite", "--", "build", "--mode", "production"],
			"vite",
		),
		["build", "--mode", "production"],
	);
});
test("alias merging preserves user precedence by default", () => {
	const aliases = mergeAliases(
		{ "@fixture/ui": "/user", "user/*": "/owned" },
		{ "@fixture/ui": "/wsrt", "@fixture/core": "/core" },
	);
	assert.equal(aliases[0].replacement, "/user");
	assert.ok(aliases.some((item) => item.replacement === "/core"));
});
test("published entry points expose WSRT plugin, adapter, and native Vite plugin", () => {
	const plugin = vitePlugin();
	assert.equal(plugin.id, "@wsrt/plugin-vite");
	assert.equal(plugin.contributions.adapters[0].id, viteAdapter.id);
	assert.equal(wsrt().name, "wsrt:workspace");
});
test("configured Vite adapters carry plugin workspace options into a consumer config", async () => {
	const adapter = createViteAdapter({
		workspace: { discover: true, aliases: true, dependencies: true },
		aliasPrecedence: "user",
	});
	const consumerRoot = process.cwd();
	const prepared = adapter.prepare(
		{ command: "build", configFile: "vite.config.ts" },
		{
			nodeId: "application:desktop/process:main",
			workspaceRoot: consumerRoot,
			projectRoot: consumerRoot,
			environment: {},
		},
	);
	try {
		assert.equal(prepared.environment.WSRT_WORKSPACE_ROOT, consumerRoot);
		assert.equal(prepared.environment.WSRT_PROJECT_ROOT, consumerRoot);
		assert.equal(prepared.args.includes("vite.config.ts"), false);
		const wrapper = prepared.args[prepared.args.indexOf("--config") + 1];
		const source = await import("node:fs/promises").then((fs) => fs.readFile(wrapper, "utf8"));
		assert.match(source, /"discover":true/);
		assert.match(source, /"dependencies":true/);
		assert.match(source, /vite\.config\.ts/);
	} finally {
		await prepared.dispose();
	}
});
