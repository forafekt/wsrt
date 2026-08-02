import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	CommandLineError,
	createCli,
	generateCompletions,
} from "../libraries/commandline/dist/mod.js";
import { createWsrtCli } from "../packages/cli/dist/cli.js";

test("declarative commands support nested paths, aliases, validation, and async actions", async () => {
	const calls = [];
	const cli = createCli({
		name: "example",
		commands: [
			{
				name: "plugin",
				description: "Manage plugins",
				commands: [
					{
						name: "install <name>",
						description: "Install a plugin",
						aliases: ["add"],
						options: [{ name: "--force", description: "Replace an installation" }],
						validate: (name) => {
							if (name === "invalid") throw new CommandLineError("invalid plugin");
						},
						action: async (name, options) => calls.push({ name, force: options.force }),
					},
				],
			},
		],
	});

	await cli.parseAsync(["node", "example", "plugin", "add", "demo", "--force"]);
	assert.deepEqual(calls, [{ name: "demo", force: true }]);
	await assert.rejects(
		cli.parseAsync(["node", "example", "plugin", "install", "invalid"]),
		/invalid plugin/,
	);
});

test("nested command arguments are finite and parsed in declaration order", async () => {
	const calls = [];
	const cli = createCli({
		name: "example",
		commands: [
			{
				name: "parent",
				description: "Parent",
				commands: [
					{
						name: "run <target> [environment] [...arguments]",
						description: "Run a target",
						action: (...args) => calls.push(args),
					},
				],
			},
		],
	});

	await cli.parseAsync(["node", "example", "parent", "run", "api", "dev", "one", "two"]);
	assert.deepEqual(calls[0].slice(0, 3), ["api", "dev", ["one", "two"]]);
});

test("cyclic declarative command hierarchies are rejected", () => {
	const command = { name: "loop", description: "Loop", commands: [] };
	command.commands.push(command);
	assert.throws(
		() => createCli({ name: "example", commands: [command] }),
		/Cyclic command hierarchy/,
	);
});

test("unknown commands offer an actionable suggestion", async () => {
	const cli = createCli({
		name: "example",
		commands: [{ name: "inspect", description: "Inspect" }],
	});
	await assert.rejects(cli.parseAsync(["node", "example", "inspec"]), /Did you mean `inspect`/);
});

test("completion generation covers supported shells", () => {
	const cli = createCli({
		name: "example",
		commands: [{ name: "run <task>", description: "Run a task" }],
	});
	assert.match(generateCompletions(cli, "bash"), /complete -F/);
	assert.match(generateCompletions(cli, "fish"), /complete -c example/);
	assert.match(generateCompletions(cli, "zsh"), /#compdef example/);
});

test("WSRT help is grouped and includes every migrated command", () => {
	const output = [];
	const original = console.log;
	console.log = (value) => output.push(String(value));
	try {
		createWsrtCli().parse(["node", "wsrt", "--help"]);
	} finally {
		console.log = original;
	}
	const help = output.join("\n");
	assert.match(help, /Inspection:/);
	assert.match(help, /Lifecycle:/);
	assert.match(help, /Execution:/);
	assert.match(help, /Workspace intelligence:/);
	assert.match(help, /workspace capabilities/);
	assert.match(help, /workspace describe/);
	assert.match(help, /workspace node/);
	assert.match(help, /workspace graph/);
	assert.match(help, /workspace files/);
	for (const command of [
		"inspect",
		"validate",
		"status",
		"events",
		"operations",
		"artifacts",
		"graph",
		"up",
		"down",
		"start",
		"stop",
		"restart",
		"run",
		"cancel",
		"exec",
		"completion",
	])
		assert.match(help, new RegExp(`\\b${command}\\b`));
});

test("help never executes command handlers and remains reusable", () => {
	let calls = 0;
	const cli = createCli({
		name: "example",
		commands: [
			{
				name: "run <target>",
				description: "Run",
				action: () => calls++,
			},
		],
	});
	const original = console.log;
	console.log = () => undefined;
	try {
		for (let index = 0; index < 100; index++) cli.parse(["node", "example", "run", "--help"]);
	} finally {
		console.log = original;
	}
	assert.equal(calls, 0);
	assert.equal(cli.commands.length, 1);
});

for (const argument of ["-h", "--help", "help", "--version"]) {
	test(`built CLI ${argument} exits promptly`, async () => {
		const result = await spawnCli(argument);
		assert.equal(result.code, 0, result.stderr);
		assert.equal(result.signal, null);
		assert.match(result.stdout, argument === "--version" ? /^wsrt\// : /Usage:/);
	});
}

test("built CLI help does not load workspace configuration or plugins", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "wsrt-help-"));
	try {
		await writeFile(
			path.join(root, "wsrt.config.mjs"),
			'throw new Error("help loaded workspace configuration");\n',
		);
		const result = await spawnCli("--root", root, "--help");
		assert.equal(result.code, 0, result.stderr);
		assert.match(result.stdout, /Usage:/);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

function spawnCli(...arguments_) {
	return new Promise((resolve, reject) => {
		const env = { ...process.env };
		delete env.NODE_TEST_CONTEXT;
		const child = spawn(
			process.execPath,
			[path.resolve("packages/cli/dist/index.js"), ...arguments_],
			{
				env,
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		let stdout = "";
		let stderr = "";
		let settled = false;
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		const timeout = setTimeout(() => {
			child.kill("SIGKILL");
			reject(
				new Error(
					`CLI timed out for ${arguments_.join(" ")} after 2000ms\nstdout:\n${stdout || "<empty>"}\nstderr:\n${stderr || "<empty>"}\nmemory: ${JSON.stringify(process.memoryUsage())}`,
				),
			);
		}, 2_000);
		child.on("error", (error) => {
			settled = true;
			clearTimeout(timeout);
			reject(
				new Error(
					`CLI child failed to spawn for ${arguments_.join(" ")}: ${error.code ?? error.name}: ${error.message}\nThis test requires permission to spawn ${process.execPath}.\nstdout:\n${stdout || "<empty>"}\nstderr:\n${stderr || "<empty>"}`,
					{ cause: error },
				),
			);
		});
		child.on("close", (code, signal) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			resolve({ code, signal, stdout, stderr });
		});
	});
}
