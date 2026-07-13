import process from "node:process";
import {
	CommandLineError,
	type CompletionShell,
	createCli,
	generateCompletions,
} from "@wsrt/commandline";
import { createControlPlane } from "@wsrt/control-plane";

export const version = "0.1.0";

interface GlobalOptions {
	root?: string;
	config?: string;
	json?: boolean;
	help?: boolean;
	version?: boolean;
	"--"?: string[];
}

const workspaceOptions = [
	{
		name: "-r, --root <directory>",
		description: "Workspace root (defaults to the current directory)",
	},
	{
		name: "-c, --config <file>",
		description: "Path to a WSRT configuration file",
	},
	{ name: "--json", description: "Emit machine-readable JSON" },
];

export function createWsrtCli() {
	const execute =
		(
			action: (
				plane: Awaited<ReturnType<typeof createControlPlane>>,
				options: GlobalOptions,
			) => unknown,
			keepAlive = false,
		) =>
		async (...args: unknown[]) => {
			const options = args.at(-1) as GlobalOptions;
			if (options.json) process.env.WSRT_JSON_OUTPUT = "1";
			const plane = await createControlPlane({
				root: options.root,
				config: options.config,
			});
			let retained = false;
			try {
				const result = await action(plane, options);
				printResult(result, !!options.json);
				if (
					keepAlive &&
					plane.definition().executables.some((item) => item.kind !== "task")
				) {
					retained = true;
					await waitForSignal(() => plane.dispose());
				}
			} finally {
				if (!retained) await plane.dispose();
			}
		};

	const cli = createCli({
		name: "wsrt",
		version,
		description:
			"Runtime-first workspace orchestration for local software systems.",
		options: workspaceOptions,
		examples: [
			"  $ wsrt inspect",
			"  $ wsrt run validate",
			"  $ wsrt exec dashboard -- --port 5177",
		],
		commands: [
			{
				name: "",
				description: "Inspect the workspace (default)",
				hidden: true,
				action: execute((plane) => plane.snapshot()),
			},
			{
				name: "inspect",
				description: "Show the complete control-plane snapshot",
				group: "Inspection",
				aliases: ["info"],
				examples: [
					"  $ wsrt inspect --json",
					"  $ wsrt inspect --root ../workspace",
				],
				action: execute((plane) => plane.snapshot()),
			},
			{
				name: "validate",
				description: "Validate the workspace definition",
				group: "Inspection",
				aliases: ["doctor"],
				action: execute((plane) => plane.validate()),
			},
			{
				name: "status",
				description: "List node lifecycle and health states",
				group: "Inspection",
				aliases: ["health"],
				action: execute((plane) => plane.snapshot().nodes),
			},
			{
				name: "events",
				description: "List control-plane events",
				group: "Inspection",
				action: execute((plane) => plane.listEvents()),
			},
			{
				name: "operations",
				description: "List lifecycle operations",
				group: "Inspection",
				action: execute((plane) => plane.listOperations()),
			},
			{
				name: "artifacts",
				description: "List workspace artifacts",
				group: "Inspection",
				action: execute((plane) => plane.listArtifacts()),
			},
			{
				name: "graph",
				description: "Print the compiled system graph",
				group: "Inspection",
				action: execute((plane) => plane.graph().toJSON()),
			},
			{
				name: "up",
				description: "Start all long-running workspace nodes",
				group: "Lifecycle",
				action: execute((plane) => plane.start(), true),
			},
			{
				name: "down",
				description: "Stop all workspace nodes",
				group: "Lifecycle",
				action: execute((plane) => plane.stop()),
			},
			{
				name: "start [...nodes]",
				description: "Start selected nodes and their dependencies",
				group: "Lifecycle",
				examples: ["  $ wsrt start api web"],
				action: (nodes: string[], options: GlobalOptions) =>
					execute((plane) => plane.start(nodes), true)(options),
			},
			{
				name: "stop [...nodes]",
				description: "Stop selected nodes and their dependants",
				group: "Lifecycle",
				action: (nodes: string[], options: GlobalOptions) =>
					execute((plane) => plane.stop(nodes))(options),
			},
			{
				name: "restart <node> [...nodes]",
				description: "Restart selected nodes",
				group: "Lifecycle",
				action: (node: string, nodes: string[], options: GlobalOptions) =>
					execute((plane) => plane.restart([node, ...nodes]), true)(options),
			},
			{
				name: "run <task>",
				description: "Run a finite workspace task",
				group: "Execution",
				examples: ["  $ wsrt run validate"],
				action: (task: string, options: GlobalOptions) =>
					execute((plane) => plane.runTask(task))(options),
			},
			{
				name: "cancel <operation-id>",
				description: "Cancel an active operation",
				group: "Lifecycle",
				action: (operationId: string, options: GlobalOptions) =>
					execute((plane) => ({
						operationId,
						cancelled: plane.cancelOperation(operationId),
					}))(options),
			},
			{
				name: "exec [executable]",
				description: "Run an executable contributed by a configured plugin",
				group: "Execution",
				allowUnknownOptions: false,
				options: [
					{
						name: "-l, --list",
						description: "List available executable contributions",
					},
				],
				examples: [
					"  $ wsrt exec --list",
					"  $ wsrt exec dashboard -- --host 127.0.0.1 --port 5177",
				],
				action: (
					id: string | undefined,
					options: GlobalOptions & { list?: boolean },
				) =>
					execute(async (plane) => {
						const { executeContribution, parseForwardedOptions } = await import(
							"./executable.js"
						);
						const result = await executeContribution(
							plane,
							id,
							parseForwardedOptions(options["--"] ?? []),
							!!options.list,
						);
						if ((!id || options.list) && !options.json) {
							printExecutableList(
								result as Array<{
									id: string;
									description?: string;
									owner: { id: string };
								}>,
							);
							return undefined;
						}
						return result;
					})(options),
			},
			{
				name: "completion [shell]",
				description: "Generate shell completion setup (bash, fish, or zsh)",
				group: "Utilities",
				validate: (shell: unknown) => {
					if (
						shell !== undefined &&
						!["bash", "fish", "zsh"].includes(String(shell))
					)
						throw new CommandLineError(
							`unsupported shell \`${shell}\`; expected bash, fish, or zsh`,
						);
				},
				action: (shell: CompletionShell | undefined) => {
					console.log(generateCompletions(cli, shell ?? detectShell()));
				},
			},
		],
	});
	return cli;
}

export async function run(argv = process.argv): Promise<void> {
	try {
		await createWsrtCli().parseAsync(argv);
	} catch (cause) {
		process.exitCode = 1;
		console.error(
			`Error: ${cause instanceof Error ? cause.message : String(cause)}`,
		);
	}
}

function printResult(result: unknown, pretty: boolean): void {
	if (result !== undefined)
		console.log(JSON.stringify(result, null, pretty ? 2 : 0));
}

function printExecutableList(
	items: Array<{ id: string; description?: string; owner: { id: string } }>,
): void {
	console.log(
		items.length
			? `Available executables\n\n${items.map((item) => `${item.id}\n  Plugin: ${item.owner.id}\n  Description: ${item.description ?? "—"}`).join("\n\n")}`
			: "Available executables\n\n  none",
	);
}

function detectShell(): CompletionShell {
	const shell = process.env.SHELL?.split("/").at(-1);
	return shell === "fish" || shell === "zsh" ? shell : "bash";
}

async function waitForSignal(dispose: () => Promise<void>): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		let closing = false;
		const close = async () => {
			if (closing) return;
			closing = true;
			try {
				await dispose();
				resolve();
			} catch (cause) {
				reject(cause);
			}
		};
		process.once("SIGINT", close);
		process.once("SIGTERM", close);
	});
}
