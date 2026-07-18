import process from "node:process";
import {
	CommandLineError,
	type CompletionShell,
	createCli,
	generateCompletions,
} from "@wsrt/commandline";
import { loadSystemDefinition } from "@wsrt/config";
import { createControlPlane } from "@wsrt/control-plane";
import {
	type CliContribution,
	type PluginContext,
	PluginSession,
	resolveWorkspacePlugins,
} from "@wsrt/plugins";
import { logger } from "./logger.js";

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

export function createWsrtCli(pluginCommands: readonly CliContribution[] = []) {
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
				name: "plugins",
				description: "List loaded plugins and their capabilities",
				group: "Plugins",
				action: execute((plane) => plane.snapshot().plugins),
			},
			{
				name: "plugins inspect [plugin]",
				description: "Inspect plugin metadata and registrations",
				group: "Plugins",
				action: (plugin: string | undefined, options: GlobalOptions) =>
					execute((plane) => {
						const plugins = plane.snapshot().plugins;
						if (!plugin) return plugins;
						const match = plugins.find((item) => item.id === plugin);
						if (!match) throw new Error(`WSRT_PLUGIN_NOT_LOADED: ${plugin}`);
						return match;
					})(options),
			},
			{
				name: "plugins graph",
				description: "Show plugin dependency relationships",
				group: "Plugins",
				action: execute((plane) =>
					plane.snapshot().plugins.flatMap((plugin) => [
						...(plugin.requires ?? []).map((dependency) => ({
							from: plugin.id,
							to: typeof dependency === "string" ? dependency : dependency.id,
							type: "required",
						})),
						...(plugin.optional ?? []).map((dependency) => ({
							from: plugin.id,
							to: typeof dependency === "string" ? dependency : dependency.id,
							type: "optional",
						})),
					]),
				),
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
				allowUnknownOptions: true,
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
						const {
							executeContribution,
							forwardedArguments,
							parseForwardedOptions,
						} = await import("./executable.js");
						const result = await executeContribution(
							plane,
							id,
							parseForwardedOptions(options["--"] ?? []),
							!!options.list,
							forwardedArguments(process.argv, id),
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
				name: "workspace inspect",
				description: "Inspect discovered packages, aliases, and relationships",
				group: "Workspace",
				action: execute(async (plane) =>
					workspaceCommand(plane.definition().root, "inspect"),
				),
			},
			{
				name: "workspace resolve",
				description: "Resolve the workspace model without writing files",
				group: "Workspace",
				action: execute(async (plane) =>
					workspaceCommand(plane.definition().root, "resolve"),
				),
			},
			{
				name: "workspace sync",
				description: "Synchronize TypeScript paths and manifest dependencies",
				group: "Workspace",
				action: execute(async (plane) =>
					workspaceCommand(plane.definition().root, "sync"),
				),
			},
			{
				name: "workspace check",
				description: "Fail when workspace projections are stale (CI safe)",
				group: "Workspace",
				action: execute(async (plane) =>
					workspaceCommand(plane.definition().root, "check"),
				),
			},
			...pluginCommands.map((contribution) => ({
				name: `${contribution.path} [...pluginArguments]`,
				description: contribution.description,
				group: `Plugin: ${contribution.owner.id}`,
				allowUnknownOptions: true,
				action: (_pluginArguments: string[], options: GlobalOptions) =>
					execute(async (plane) => {
						const args = argumentsAfterPath(process.argv, contribution.path);
						return contribution.run(pluginContext(plane), args);
					})(options),
			})),
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
					logger.log(generateCompletions(cli, shell ?? detectShell()));
				},
			},
		],
	});
	return cli;
}

async function workspaceCommand(
	root: string,
	command: "inspect" | "resolve" | "sync" | "check",
) {
	const { projectWorkspace, resolveWorkspace, syncWorkspace } = await import(
		"@wsrt/workspace"
	);
	const workspace = await resolveWorkspace({ root });
	if (command === "inspect" || command === "resolve") return workspace;
	const projections = await projectWorkspace(workspace);
	const result = await syncWorkspace(
		projections,
		command === "sync" ? "write" : "check",
	);
	if (!result.ok)
		throw new Error(
			`WSRT_WORKSPACE_DRIFT: ${result.changed.flatMap((item) => item.diagnostics.map((diagnostic) => diagnostic.message)).join("\n")}`,
		);
	return {
		mode: command,
		changed: result.changed.map((item) => ({
			file: item.file,
			kind: item.kind,
		})),
		diagnostics: result.changed.flatMap((item) => item.diagnostics),
	};
}

export async function run(argv = process.argv): Promise<void> {
	try {
		await createWsrtCli(await discoverPluginCommands(argv)).parseAsync(argv);
	} catch (cause) {
		process.exitCode = 1;
		logger.error(
			`Error: ${cause instanceof Error ? cause.message : String(cause)}`,
		);
	}
}

async function discoverPluginCommands(
	argv: readonly string[],
): Promise<readonly CliContribution[]> {
	const rootIndex = argv.findIndex(
		(item) => item === "--root" || item === "-r",
	);
	const configIndex = argv.findIndex(
		(item) => item === "--config" || item === "-c",
	);
	const root =
		rootIndex >= 0 && argv[rootIndex + 1] ? argv[rootIndex + 1] : undefined;
	const config =
		configIndex >= 0 && argv[configIndex + 1]
			? argv[configIndex + 1]
			: undefined;
	const loaded = await loadSystemDefinition(root, config);
	if (!loaded.definition) return [];
	const plugins = await resolveWorkspacePlugins(
		loaded.definition.plugins,
		loaded.definition.root,
	);
	const contributions = new PluginSession(plugins).contributions("cli");
	const paths = new Set<string>();
	for (const contribution of contributions) {
		if (paths.has(contribution.path))
			throw new Error(`WSRT_PLUGIN_CLI_DUPLICATE: ${contribution.path}`);
		paths.add(contribution.path);
	}
	return contributions;
}
function pluginContext(
	plane: Awaited<ReturnType<typeof createControlPlane>>,
): PluginContext {
	return Object.freeze({
		root: plane.definition().root,
		configuration: plane.definition(),
		logger: {
			info: logger.info.bind(logger),
			warn: logger.warn.bind(logger),
			error: logger.error.bind(logger),
		},
		diagnostics: {
			add: (diagnostic) =>
				logger[
					diagnostic.severity === "warning" ? "warn" : diagnostic.severity
				](diagnostic.message),
		},
		events: {
			emit: (type, payload) =>
				logger.info(
					type,
					payload && typeof payload === "object"
						? (payload as Record<string, unknown>)
						: { payload },
				),
		},
		services: Object.freeze({ controlPlane: plane, graph: plane.graph() }),
	});
}
function argumentsAfterPath(
	argv: readonly string[],
	commandPath: string,
): string[] {
	const parts = commandPath.split(/\s+/).filter(Boolean);
	for (let index = 0; index <= argv.length - parts.length; index++)
		if (parts.every((part, offset) => argv[index + offset] === part)) {
			const result = argv.slice(index + parts.length);
			return result[0] === "--" ? result.slice(1) : result;
		}
	return [];
}

function printResult(result: unknown, _pretty: boolean): void {
	if (result !== undefined)
		logger.log(
			`wsrt ${process.argv.slice(2).join(" ")}`,
			result && typeof result === "object"
				? (result as Record<string, unknown>)
				: { result },
		);
}

function printExecutableList(
	items: Array<{ id: string; description?: string; owner: { id: string } }>,
): void {
	logger.log(
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
