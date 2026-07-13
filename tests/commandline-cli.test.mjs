import assert from "node:assert/strict";
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
						options: [
							{ name: "--force", description: "Replace an installation" },
						],
						validate: (name) => {
							if (name === "invalid")
								throw new CommandLineError("invalid plugin");
						},
						action: async (name, options) =>
							calls.push({ name, force: options.force }),
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

test("unknown commands offer an actionable suggestion", async () => {
	const cli = createCli({
		name: "example",
		commands: [{ name: "inspect", description: "Inspect" }],
	});
	await assert.rejects(
		cli.parseAsync(["node", "example", "inspec"]),
		/Did you mean `inspect`/,
	);
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
