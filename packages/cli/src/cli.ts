import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import {
	CommandLineError,
	type CompletionShell,
	createCli,
	generateCompletions,
} from "@wsrt/commandline";
import type { WsrtConfigFormat } from "@wsrt/config";
import type { CliContribution, PluginContext, PluginSession } from "@wsrt/plugins";
import type { WorkspaceRequest, WorkspaceSessionClient } from "@wsrt/workspace-session";
import { integrationTargets, removeIntegration, setupIntegration } from "./integrations.js";
import { logger } from "./logger.js";

const packageMetadata = createRequire(import.meta.url)("../package.json") as {
	readonly name: string;
	readonly version: string;
};

export const version = packageMetadata.version;

interface GlobalOptions {
	root?: string;
	config?: string;
	json?: boolean;
	help?: boolean;
	version?: boolean;
	"--"?: string[];
}

interface ConfigWriteOptions extends GlobalOptions {
	format?: string;
	output?: string;
	to?: string;
	from?: string;
	force?: boolean;
	outputFormat?: string;
	stdout?: boolean;
	check?: boolean;
	plan?: boolean;
	checkCommands?: boolean;
	checkPorts?: boolean;
	checkNetwork?: boolean;
}

interface WorkspaceQueryOptions extends GlobalOptions {
	depth?: number;
	direction?: "dependencies" | "dependents" | "both";
	kind?: string;
	role?: string;
	path?: string;
	includeGenerated?: boolean;
	limit?: number;
	cursor?: string;
}

type WorkspaceGraphRequest = Extract<WorkspaceRequest, { type: "workspace.graph.query" }>;

type WorkspaceFilesRequest = Extract<WorkspaceRequest, { type: "workspace.files.query" }>;

type WorkspacePlanRequest = Extract<WorkspaceRequest, { type: "workspace.command.plan" }>;

class ReportedConfigurationError extends Error {}

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

export function createWsrtCli(
	pluginCommands: readonly CliContribution[] = [],
	pluginSession?: PluginSession,
	cliVersion = version,
) {
	const execute =
		(action: (client: WorkspaceSessionClient, options: GlobalOptions) => unknown) =>
		async (...args: unknown[]) => {
			const options = args.at(-1) as GlobalOptions;
			if (options.json) process.env.WSRT_JSON_OUTPUT = "1";
			const { connectOrStartWorkspaceSession } = await import("@wsrt/workspace-session");
			const client = await connectOrStartWorkspaceSession({
				root: options.root,
				config: options.config,
			});
			try {
				const result = await action(client, options);
				printResult(result, !!options.json);
			} finally {
				await client.close();
			}
		};

	const cli = createCli({
		name: "wsrt",
		version: cliVersion,
		description: "Runtime-first workspace orchestration for local software systems.",
		options: workspaceOptions,
		// examples: [
		// 	"  $ wsrt inspect",
		// 	"  $ wsrt run validate",
		// 	"  $ wsrt exec dashboard -- --port 5177",
		// ],
		commands: [
			{
				name: "integrate list",
				description: "List vendor-neutral consumer integration adapters",
				group: "Integration",
				action: (options: GlobalOptions) => printResult(integrationTargets, !!options.json),
			},
			{
				name: "integrate setup <target>",
				description: "Install managed consumer instructions without replacing user content",
				group: "Integration",
				action: (target: string, options: GlobalOptions) =>
					execute((client) => setupIntegration(client.session.workspaceRoot, target, client))(
						options,
					),
			},
			{
				name: "integrate remove <target>",
				description: "Remove WSRT-managed consumer integration content",
				group: "Integration",
				action: async (target: string, options: GlobalOptions) => {
					const root = path.resolve(options.root ?? process.cwd());
					printResult(await removeIntegration(root, target), !!options.json);
				},
			},
			{
				name: "workspace capabilities",
				description: "Describe authoritative workspace protocol capabilities",
				group: "Workspace intelligence",
				examples: ["  $ wsrt workspace capabilities --json"],
				action: execute((client) => client.request({ type: "workspace.capabilities" })),
			},
			{
				name: "workspace describe",
				description: "Describe the authoritative semantic workspace model",
				group: "Workspace intelligence",
				examples: ["  $ wsrt workspace describe --json"],
				action: execute((client) => client.request({ type: "workspace.describe" })),
			},
			{
				name: "workspace node <node-id>",
				description: "Describe one authoritative workspace node",
				group: "Workspace intelligence",
				examples: ["  $ wsrt workspace node application:desktop --json"],
				action: (nodeId: string, options: GlobalOptions) =>
					execute((client) => client.request({ type: "workspace.node.describe", nodeId }))(options),
			},
			{
				name: "workspace graph [node-id]",
				description: "Query dependencies or dependents from a workspace node",
				group: "Workspace intelligence",
				options: [
					{ name: "--depth <number>", description: "Traversal depth (0-32)" },
					{ name: "--direction <direction>", description: "dependencies, dependents, or both" },
					{ name: "--kind <kind>", description: "Include a selected node kind" },
					{ name: "--limit <number>", description: "Maximum nodes (1-500)" },
				],
				examples: ["  $ wsrt workspace graph application:desktop --depth 2 --json"],
				action: (nodeId: string | undefined, options: WorkspaceQueryOptions) => {
					if (!nodeId) throw new CommandLineError("workspace graph requires a node ID");
					return execute((client) =>
						client.request({
							type: "workspace.graph.query",
							query: {
								roots: [nodeId],
								...(options.depth !== undefined ? { depth: Number(options.depth) } : {}),
								...(options.direction ? { direction: options.direction } : {}),
								...(options.kind
									? { kinds: [options.kind] as WorkspaceGraphRequest["query"]["kinds"] }
									: {}),
								...(options.limit !== undefined ? { limit: Number(options.limit) } : {}),
							},
						}),
					)(options);
				},
			},
			{
				name: "workspace files [node-id]",
				description: "Query declared source ownership for nodes, roles, or paths",
				group: "Workspace intelligence",
				options: [
					{ name: "--role <role>", description: "Include a selected file role" },
					{ name: "--path <path>", description: "Resolve an explicit workspace-relative path" },
					{ name: "--include-generated", description: "Include generated files" },
					{ name: "--limit <number>", description: "Page size (1-500)" },
					{ name: "--cursor <cursor>", description: "Continue a previous query" },
				],
				examples: ["  $ wsrt workspace files application:desktop --role source --json"],
				action: (nodeId: string | undefined, options: WorkspaceQueryOptions) =>
					execute((client) =>
						client.request({
							type: "workspace.files.query",
							query: {
								...(nodeId ? { nodeIds: [nodeId] } : {}),
								...(options.role
									? { roles: [options.role] as WorkspaceFilesRequest["query"]["roles"] }
									: {}),
								...(options.path ? { paths: [options.path] } : {}),
								...(options.includeGenerated ? { includeGenerated: true } : {}),
								...(options.limit !== undefined ? { limit: Number(options.limit) } : {}),
								...(options.cursor ? { cursor: options.cursor } : {}),
							},
						}),
					)(options),
			},
			{
				name: "workspace impact [...paths]",
				description: "Analyze evidence-backed impact of changed workspace paths",
				group: "Workspace intelligence",
				examples: ["  $ wsrt workspace impact apps/web/src.js --json"],
				action: (paths: string[], options: GlobalOptions) => {
					if (!paths.length)
						throw new CommandLineError("workspace impact requires at least one path");
					return execute((client) => client.analyzeChangeImpact({ paths }))(options);
				},
			},
			{
				name: "workspace owners <path>",
				description: "Resolve authoritative owners for a workspace-relative path",
				group: "Workspace intelligence",
				examples: ["  $ wsrt workspace owners apps/desktop/vite.config.ts --json"],
				action: (file: string, options: GlobalOptions) =>
					execute((client) => client.fileOwners(file))(options),
			},
			{
				name: "workspace validate-change [...paths]",
				description: "Recommend ordered validation tasks for changed workspace paths",
				group: "Workspace intelligence",
				examples: ["  $ wsrt workspace validate-change apps/desktop/vite.config.ts --json"],
				action: (paths: string[], options: GlobalOptions) => {
					if (!paths.length)
						throw new CommandLineError("workspace validate-change requires at least one path");
					return execute((client) => client.recommendValidation({ paths }))(options);
				},
			},
			{
				name: "workspace command plan <command> [...targets]",
				description: "Plan a workspace command without executing it",
				group: "Workspace intelligence",
				examples: ["  $ wsrt workspace command plan node.start application:web --json"],
				action: (command: string, targets: string[], options: GlobalOptions) =>
					execute((client) => client.planCommand(parseWorkspaceCommand(command, targets)))(options),
			},
			{
				name: "workspace command execute <command> [...targets]",
				description: "Plan and execute a permissioned workspace command",
				group: "Workspace intelligence",
				examples: ["  $ wsrt workspace command execute task.run build --json"],
				action: (command: string, targets: string[], options: GlobalOptions) =>
					execute(async (client) => {
						const parsed = parseWorkspaceCommand(command, targets);
						const plan = await client.planCommand(parsed);
						if (!plan.result.valid)
							throw new CommandLineError(
								plan.result.warnings.join("; ") || "Command plan is invalid",
							);
						return client.executeWorkspaceCommand(parsed, {
							permissions: plan.result.requiredPermissions as never,
							expectedRevision: plan.metadata.workspaceRevision,
						});
					})(options),
			},
			{
				name: "init",
				description: "Create a discoverable WSRT configuration (YAML by default)",
				group: "Configuration",
				options: [
					{ name: "-f, --format <format>", description: "Output format (default: yaml)" },
					{ name: "-o, --output <file>", description: "Output path (format is inferred)" },
					{ name: "--force", description: "Overwrite an existing destination" },
				],
				examples: [
					"  $ wsrt init",
					"  $ wsrt init --format ts",
					"  $ wsrt init --output config/wsrt.json",
					"  $ wsrt init --force",
				],
				action: (options: ConfigWriteOptions) => initializeConfig(options),
			},
			{
				name: "config validate [source]",
				description: "Validate configuration structure, semantics, and graph without runtimes",
				group: "Configuration",
				options: [
					{ name: "--from <file>", description: "Source configuration path" },
					{ name: "--output-format <format>", description: "Output format (text or json)" },
				],
				examples: [
					"  $ wsrt config validate",
					"  $ wsrt config validate wsrt.yaml",
					"  $ wsrt config validate --from config/wsrt.json --json",
				],
				action: (source: string | undefined, options: ConfigWriteOptions) =>
					validateConfigCommand(source, options),
			},
			{
				name: "config test [source]",
				description: "Resolve providers and execution plans without starting the workspace",
				group: "Configuration",
				options: [
					{ name: "--from <file>", description: "Source configuration path" },
					{ name: "--plan", description: "Print startup and shutdown stages" },
					{ name: "--check-commands", description: "Check command availability using PATH" },
					{ name: "--check-ports", description: "Check configured ports where supported" },
					{ name: "--check-network", description: "Check remote references where supported" },
					{ name: "--output-format <format>", description: "Output format (text or json)" },
				],
				examples: [
					"  $ wsrt config test",
					"  $ wsrt config test wsrt.config.ts --plan",
					"  $ wsrt config test --check-commands --json",
				],
				action: (source: string | undefined, options: ConfigWriteOptions) =>
					testConfigCommand(source, options),
			},
			{
				name: "config convert [source]",
				description:
					"Convert a resolved, validated config (dynamic code and comments are not preserved)",
				group: "Configuration",
				options: [
					{ name: "--from <file>", description: "Source configuration path" },
					{ name: "--to <format>", description: "Destination format" },
					{ name: "-o, --output <file>", description: "Explicit destination path" },
					{ name: "--force", description: "Overwrite an existing destination" },
				],
				examples: [
					"  $ wsrt config convert --to json",
					"  $ wsrt config convert wsrt.yaml --to ts",
					"  $ wsrt config convert --from wsrt.config.ts --output wsrt.yaml",
					"  $ wsrt config convert --to yaml --force",
				],
				action: (source: string | undefined, options: ConfigWriteOptions) =>
					convertConfig(source, options),
			},
			{
				name: "config schema",
				description: "Inspect, export, or verify the bundled WSRT JSON Schema",
				group: "Configuration",
				options: [
					{ name: "-o, --output <file>", description: "Write the schema to a file" },
					{ name: "--stdout", description: "Write the complete schema to standard output" },
					{ name: "--check", description: "Fail if the bundled schema has drifted" },
				],
				examples: [
					"  $ wsrt config schema",
					"  $ wsrt config schema --output .wsrt/wsrt.schema.json",
					"  $ wsrt config schema --stdout",
					"  $ wsrt config schema --check",
				],
				action: (options: ConfigWriteOptions) => configSchemaCommand(options),
			},
			{
				name: "",
				description: "Inspect the workspace (default)",
				hidden: true,
				action: execute((client) => client.snapshot()),
			},
			{
				name: "inspect",
				description: "Show the complete control-plane snapshot",
				group: "Inspection",
				aliases: ["info"],
				examples: ["  $ wsrt inspect --json", "  $ wsrt inspect --root ../workspace"],
				action: execute((client) => client.snapshot()),
			},
			{
				name: "validate",
				description: "Validate the workspace definition",
				group: "Inspection",
				aliases: ["doctor"],
				action: execute((client) => client.diagnostics()),
			},
			{
				name: "status",
				description: "List node lifecycle and health states",
				group: "Inspection",
				aliases: ["health"],
				action: execute(async (client) => (await client.snapshot()).nodes),
			},
			{
				name: "events",
				description: "List control-plane events",
				group: "Inspection",
				action: execute((client) => client.events()),
			},
			{
				name: "operations",
				description: "List lifecycle operations",
				group: "Inspection",
				action: execute((client) => client.operations()),
			},
			{
				name: "artifacts",
				description: "List workspace artifacts",
				group: "Inspection",
				action: execute((client) => client.artifacts()),
			},
			{
				name: "graph",
				description: "Print the compiled system graph",
				group: "Inspection",
				action: execute((client) => client.graph()),
			},
			{
				name: "plugins",
				description: "List loaded plugins and their capabilities",
				group: "Plugins",
				action: execute(async (client) => (await client.snapshot()).plugins),
			},
			{
				name: "plugins inspect [plugin]",
				description: "Inspect plugin metadata and registrations",
				group: "Plugins",
				action: (plugin: string | undefined, options: GlobalOptions) =>
					execute(async (client) => {
						const plugins = (await client.snapshot()).plugins;
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
				action: execute(async (client) =>
					(await client.snapshot()).plugins.flatMap((plugin) => [
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
				action: execute((client) => client.submit({ type: "node.start", nodeIds: [] })),
			},
			{
				name: "session status",
				description: "Show the authoritative workspace session",
				group: "Session",
				action: execute((client) => client.status()),
			},
			{
				name: "session start",
				description: "Start or connect to the authoritative workspace session",
				group: "Session",
				action: execute((client) => client.status()),
			},
			{
				name: "session stop",
				description: "Orderly stop the authoritative workspace session",
				group: "Session",
				action: execute((client) => client.stopSession()),
			},
			{
				name: "session restart",
				description: "Orderly restart the authoritative workspace session",
				group: "Session",
				action: async (options: GlobalOptions) => {
					const { connectOrStartWorkspaceSession } = await import("@wsrt/workspace-session");
					const current = await connectOrStartWorkspaceSession({
						root: options.root,
						config: options.config,
					});
					await current.stopSession();
					await current.close();
					const next = await connectOrStartWorkspaceSession({
						root: options.root,
						config: options.config,
					});
					try {
						printResult(await next.status(), !!options.json);
					} finally {
						await next.close();
					}
				},
			},
			{
				name: "down",
				description: "Stop all workspace nodes",
				group: "Lifecycle",
				action: execute((client) => client.execute({ type: "node.stop", nodeIds: [] })),
			},
			{
				name: "start [...nodes]",
				description: "Start selected nodes and their dependencies",
				group: "Lifecycle",
				examples: ["  $ wsrt start api web"],
				action: (nodes: string[], options: GlobalOptions) =>
					execute((client) => client.submit({ type: "node.start", nodeIds: nodes }))(options),
			},
			{
				name: "stop [...nodes]",
				description: "Stop selected nodes and their dependants",
				group: "Lifecycle",
				action: (nodes: string[], options: GlobalOptions) =>
					execute((client) => client.execute({ type: "node.stop", nodeIds: nodes }))(options),
			},
			{
				name: "restart <node> [...nodes]",
				description: "Restart selected nodes",
				group: "Lifecycle",
				action: (node: string, nodes: string[], options: GlobalOptions) =>
					execute((client) => client.submit({ type: "node.restart", nodeIds: [node, ...nodes] }))(
						options,
					),
			},
			{
				name: "run <task>",
				description: "Run a finite workspace task",
				group: "Execution",
				examples: ["  $ wsrt run validate"],
				action: (task: string, options: GlobalOptions) =>
					execute((client) => client.execute({ type: "task.run", taskId: task }))(options),
			},
			{
				name: "cancel <operation-id>",
				description: "Cancel an active operation",
				group: "Lifecycle",
				action: (operationId: string, options: GlobalOptions) =>
					execute((client) => client.execute({ type: "operation.cancel", operationId }))(options),
			},
			{
				name: "exec [executable] [...executableArguments]",
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
					_executableArguments: string[],
					options: GlobalOptions & { list?: boolean },
				) =>
					execute(async (client) => {
						const { executeContribution, forwardedArguments, parseForwardedOptions } = await import(
							"./executable.js"
						);
						const result = await executeContribution(
							client,
							pluginSession?.contributions("executables") ?? [],
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
				action: execute(async (client) =>
					workspaceCommand((await client.snapshot()).workspace.root, "inspect"),
				),
			},
			{
				name: "workspace resolve",
				description: "Resolve the workspace model without writing files",
				group: "Workspace",
				action: execute(async (client) =>
					workspaceCommand((await client.snapshot()).workspace.root, "resolve"),
				),
			},
			{
				name: "workspace sync",
				description: "Synchronize TypeScript paths and manifest dependencies",
				group: "Workspace",
				action: execute(async (client) =>
					workspaceCommand((await client.snapshot()).workspace.root, "sync"),
				),
			},
			{
				name: "workspace check",
				description: "Fail when workspace projections are stale (CI safe)",
				group: "Workspace",
				action: execute(async (client) =>
					workspaceCommand((await client.snapshot()).workspace.root, "check"),
				),
			},
			...pluginCommands.map((contribution) => ({
				name: `${contribution.path} [...pluginArguments]`,
				description: contribution.description,
				group: `Plugin: ${contribution.owner.id}`,
				allowUnknownOptions: true,
				action: (_pluginArguments: string[], options: GlobalOptions) =>
					execute(async (client) => {
						const args = argumentsAfterPath(process.argv, contribution.path);
						return contribution.run(await pluginContext(client), args);
					})(options),
			})),
			{
				name: "completion query [input]",
				description: "Resolve runtime completion candidates",
				hidden: true,
				action: async (input: string | undefined, options: GlobalOptions) => {
					const { connectOrStartWorkspaceSession } = await import("@wsrt/workspace-session");
					const client = await connectOrStartWorkspaceSession({
						root: options.root,
						config: options.config,
					});
					try {
						process.stdout.write(`${(await client.complete(input ?? "")).join("\n")}\n`);
					} finally {
						await client.close();
					}
				},
			},
			{
				name: "completion [shell]",
				description: "Generate shell completion setup (bash, fish, or zsh)",
				group: "Utilities",
				validate: (shell: unknown) => {
					if (shell !== undefined && !["bash", "fish", "zsh"].includes(String(shell)))
						throw new CommandLineError(
							`unsupported shell \`${shell}\`; expected bash, fish, or zsh`,
						);
				},
				action: (shell: CompletionShell | undefined) => {
					process.stdout.write(`${generateCompletions(cli, shell ?? detectShell())}\n`);
				},
			},
		],
	});
	return cli;
}

async function workspaceCommand(root: string, command: "inspect" | "resolve" | "sync" | "check") {
	const { projectWorkspace, resolveWorkspace, syncWorkspace } = await import("@wsrt/workspace");
	const workspace = await resolveWorkspace({ root });
	if (command === "inspect" || command === "resolve") return workspace;
	const projections = await projectWorkspace(workspace);
	const result = await syncWorkspace(projections, command === "sync" ? "write" : "check");
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

export async function run(argv = process.argv, cliVersion = version): Promise<void> {
	let session: PluginSession | undefined;
	try {
		const bootstrapArgv =
			argv[2] === "help" ? [...argv.slice(0, 2), "--help", ...argv.slice(3)] : argv;
		const separator = bootstrapArgv.indexOf("--");
		const bootstrapArguments =
			separator < 0 ? bootstrapArgv.slice(2) : bootstrapArgv.slice(2, separator);
		if (bootstrapArguments.includes("-h") || bootstrapArguments.includes("--help")) {
			await createWsrtCli([], undefined, cliVersion).parseAsync(bootstrapArgv);
			return;
		}
		if (bootstrapArguments.includes("-v") || bootstrapArguments.includes("--version")) {
			await createWsrtCli([], undefined, cliVersion).parseAsync(bootstrapArgv);
			return;
		}
		const utilityCommand =
			bootstrapArguments[0] === "init" ||
			bootstrapArguments[0] === "integrate" ||
			(bootstrapArguments[0] === "config" &&
				["convert", "validate", "test", "schema"].includes(bootstrapArguments[1] ?? ""));
		if (utilityCommand) {
			await createWsrtCli([], undefined, cliVersion).parseAsync(argv);
			return;
		}
		const resolved = await discoverPluginCommands(argv);
		session = resolved.session;
		await createWsrtCli(resolved.commands, session, cliVersion).parseAsync(argv);
	} catch (cause) {
		process.exitCode = 1;
		if (cause instanceof ReportedConfigurationError) return;
		const message = cause instanceof Error ? cause.message : String(cause);
		if (argv.includes("--json"))
			process.stderr.write(`${JSON.stringify({ error: { code: errorCode(cause), message } })}\n`);
		else logger.error(`Error: ${message}`);
	} finally {
		await session
			?.dispose()
			.catch((cause) =>
				logger.error(`Error: ${cause instanceof Error ? cause.message : String(cause)}`),
			);
	}
}

async function initializeConfig(options: ConfigWriteOptions): Promise<void> {
	const {
		configFormatFromPath,
		createNullishSystemTemplate,
		defaultConfigFileName,
		isConfigFormat,
		serializeConfig,
		WSRT_CONFIG_SCHEMA_URL,
	} = await import("@wsrt/config");
	const root = path.resolve(options.root ?? process.cwd());
	const requested = options.format?.toLowerCase();
	if (requested && !isConfigFormat(requested))
		throw new CommandLineError(`unsupported configuration format \`${requested}\``);
	const inferred = options.output ? configFormatFromPath(options.output) : undefined;
	if (options.output && !inferred)
		throw new CommandLineError(
			`cannot infer a supported configuration format from output path \`${options.output}\``,
		);
	if (requested && inferred && requested !== inferred)
		throw new CommandLineError(
			`format \`${requested}\` conflicts with output extension \`.${inferred}\``,
		);
	const format = (requested ?? inferred ?? "yaml") as WsrtConfigFormat;
	const file = path.resolve(root, options.output ?? defaultConfigFileName(format));
	const staticTemplate = ["yaml", "yml", "json"].includes(format);
	let contents = serializeConfig(
		staticTemplate
			? createNullishSystemTemplate(path.basename(root))
			: {
					$schema: WSRT_CONFIG_SCHEMA_URL,
					schemaVersion: "1",
					name: path.basename(root),
				},
		{ format },
	);
	if (format === "yaml" || format === "yml")
		contents = `# yaml-language-server: $schema=${WSRT_CONFIG_SCHEMA_URL}\n\n${contents}`;
	await writeConfiguration(file, contents, !!options.force);
	process.stdout.write(
		`Created ${file} (${format}, full discoverable template${options.force ? ", overwrite enabled" : ""}).\n`,
	);
}

async function validateConfigCommand(
	positionalSource: string | undefined,
	options: ConfigWriteOptions,
): Promise<void> {
	const report = await inspectConfiguration(positionalSource, options, false);
	printConfigurationReport(report, options, false);
	if (!report.valid) throw new ReportedConfigurationError("Configuration is invalid");
}

async function testConfigCommand(
	positionalSource: string | undefined,
	options: ConfigWriteOptions,
): Promise<void> {
	const report = await inspectConfiguration(positionalSource, options, true);
	printConfigurationReport(report, options, true);
	if (!report.valid) throw new ReportedConfigurationError("Configuration test failed");
}

type ConfigurationReport = {
	valid: boolean;
	source: string;
	format?: string;
	errors: Array<{
		code: string;
		path: string[];
		message: string;
		line?: number;
		column?: number;
	}>;
	warnings: Array<{ code: string; path: string[]; message: string }>;
	counts?: Record<string, number>;
	plugins?: string[];
	providers?: { runtimes: string[]; adapters: string[] };
	startupPlan?: readonly (readonly string[])[];
	shutdownPlan?: readonly (readonly string[])[];
	checks?: Record<string, string>;
};

async function inspectConfiguration(
	positionalSource: string | undefined,
	options: ConfigWriteOptions,
	deep: boolean,
): Promise<ConfigurationReport> {
	const { compileSystemGraph, configFormatFromPath, loadSystemDefinition } = await import(
		"@wsrt/config"
	);
	if (positionalSource && options.from)
		throw new CommandLineError("source was supplied both positionally and with `--from`");
	const root = path.resolve(options.root ?? process.cwd());
	const source = options.from ?? positionalSource ?? options.config;
	const loaded = await loadSystemDefinition(root, source);
	const report: ConfigurationReport = {
		valid: false,
		source: loaded.file ?? path.resolve(root, source ?? ""),
		format: loaded.file ? configFormatFromPath(loaded.file) : undefined,
		errors: loaded.diagnostics
			.filter((item) => item.severity === "error")
			.map((item) => ({
				code: item.code,
				path: item.source.path ? item.source.path.split(".") : [],
				message: item.message,
				line: item.source.line,
				column: item.source.column,
			})),
		warnings: loaded.diagnostics
			.filter((item) => item.severity === "warning")
			.map((item) => ({
				code: item.code,
				path: item.source.path ? item.source.path.split(".") : [],
				message: item.message,
			})),
	};
	if (!loaded.definition) return report;
	let graph: ReturnType<typeof compileSystemGraph> | undefined;
	try {
		graph = compileSystemGraph(loaded.definition);
		for (const issue of graph.validate())
			report.errors.push({
				code: `graph.${issue.code}`,
				path: [...issue.path],
				message: issue.message,
			});
	} catch (cause) {
		report.errors.push({
			code: "graph.compile_failed",
			path: [],
			message: cause instanceof Error ? cause.message : String(cause),
		});
	}
	const counts: Record<string, number> = {};
	if (graph) for (const node of graph.nodes()) counts[node.kind] = (counts[node.kind] ?? 0) + 1;
	report.counts = counts;
	if (!deep || report.errors.length || !graph) {
		report.valid = report.errors.length === 0;
		return report;
	}

	const fs = await import("node:fs/promises");
	const { resolveWorkspacePluginsReport } = await import("@wsrt/plugins");
	const resolved = await resolveWorkspacePluginsReport(
		loaded.definition.plugins,
		loaded.definition.root,
	);
	report.plugins = resolved.plugins.map((plugin) => plugin.id).sort();
	for (const diagnostic of resolved.diagnostics)
		report.errors.push({
			code: diagnostic.code,
			path: ["plugins", diagnostic.plugin],
			message: diagnostic.message,
		});
	const runtimeProviders = new Set(["node"]);
	const adapters = new Set<string>();
	for (const plugin of resolved.plugins) {
		for (const provider of plugin.contributions?.runtimes ?? []) runtimeProviders.add(provider.id);
		for (const adapter of plugin.contributions?.adapters ?? []) adapters.add(adapter.id);
		const configured = loaded.definition.plugins.find(
			(item) => typeof item !== "string" && "provider" in item && item.provider === plugin.id,
		);
		for (const contribution of plugin.contributions?.configuration ?? [])
			for (const diagnostic of contribution.validate(
				typeof configured === "object" && "options" in configured ? configured.options : undefined,
			))
				(diagnostic.severity === "warning" ? report.warnings : report.errors).push({
					code: diagnostic.code,
					path: ["plugins", plugin.id],
					message: diagnostic.message,
				});
	}
	report.providers = {
		runtimes: [...runtimeProviders].sort(),
		adapters: [...adapters].sort(),
	};
	for (const [runtime, definition] of Object.entries(loaded.definition.runtimes))
		if (!runtimeProviders.has(definition.provider))
			report.errors.push({
				code: "runtime.provider_missing",
				path: ["runtimes", runtime, "provider"],
				message: `Runtime provider not available: ${definition.provider}`,
			});
	for (const executable of loaded.definition.executables) {
		if (executable.provider && !adapters.has(executable.provider.provider))
			report.errors.push({
				code: "adapter.provider_missing",
				path: [...executable.source.path.split("."), "provider"],
				message: `Execution adapter not available: ${executable.provider.provider}`,
			});
		try {
			const stat = await fs.stat(executable.root);
			if (!stat.isDirectory()) throw new Error("not a directory");
		} catch {
			report.errors.push({
				code: "executable.root_missing",
				path: [...executable.source.path.split("."), "root"],
				message: `Working directory does not exist: ${executable.root}`,
			});
		}
		if (options.checkCommands && executable.command) {
			const available = await commandExists(executable.command.command, executable.root);
			if (!available)
				report.errors.push({
					code: "executable.command_missing",
					path: [...executable.source.path.split("."), "command"],
					message: `Command is not available: ${executable.command.command}`,
				});
		}
	}
	const ids = loaded.definition.executables.map((item) => item.id);
	report.startupPlan = graph.plan(ids).stages;
	report.shutdownPlan = graph.shutdownPlan(ids).stages;
	report.checks = {
		commands: options.checkCommands ? "checked" : "skipped (opt in with --check-commands)",
		ports: options.checkPorts
			? "no declarative bind ports to check"
			: "skipped (opt in with --check-ports)",
		network: options.checkNetwork
			? "no remote configuration sources to check"
			: "skipped (opt in with --check-network)",
	};
	for (const plugin of [...resolved.plugins].reverse()) await plugin.dispose?.();
	report.valid = report.errors.length === 0;
	return report;
}

async function commandExists(command: string, root: string): Promise<boolean> {
	const fs = await import("node:fs/promises");
	if (path.isAbsolute(command) || command.includes(path.sep))
		return fs
			.access(path.resolve(root, command))
			.then(() => true)
			.catch(() => false);
	for (const directory of (process.env.PATH ?? "").split(path.delimiter))
		if (
			await fs
				.access(path.join(directory, command))
				.then(() => true)
				.catch(() => false)
		)
			return true;
	return false;
}

function printConfigurationReport(
	report: ConfigurationReport,
	options: ConfigWriteOptions,
	test: boolean,
): void {
	const outputFormat = options.json ? "json" : (options.outputFormat ?? "text");
	if (!["text", "json"].includes(outputFormat))
		throw new CommandLineError("output format must be `text` or `json`");
	if (outputFormat === "json") {
		process.stdout.write(`${JSON.stringify(report)}\n`);
		return;
	}
	if (!report.valid) {
		process.stdout.write(
			`${test ? "Configuration test failed" : "Invalid WSRT configuration"}.\n\nSource: ${report.source}\n${report.errors
				.map(
					(error) =>
						`Path: ${error.path.join(".") || "<root>"}\nError: ${error.message}${error.line ? `\nLocation: ${error.line}:${error.column ?? 1}` : ""}`,
				)
				.join("\n\n")}\n`,
		);
		return;
	}
	const counts = Object.entries(report.counts ?? {})
		.map(([kind, count]) => `${kind[0].toUpperCase()}${kind.slice(1)}: ${count}`)
		.join("\n");
	process.stdout.write(
		`${test ? "Configuration test passed" : "Configuration is valid"}.\n\nSource: ${report.source}\nFormat: ${report.format ?? "unknown"}\n${counts}\nWarnings: ${report.warnings.length}\n`,
	);
	if (test && options.plan)
		process.stdout.write(
			`\nStartup plan:\n${formatPlan(report.startupPlan ?? [])}\n\nShutdown plan:\n${formatPlan(report.shutdownPlan ?? [])}\n`,
		);
}

function formatPlan(stages: readonly (readonly string[])[]): string {
	return stages
		.map(
			(stage, index) =>
				`  Stage ${index + 1}${stage.length > 1 ? ", parallel" : ""}:\n${stage.map((id) => `    - ${id}`).join("\n")}`,
		)
		.join("\n\n");
}

async function configSchemaCommand(options: ConfigWriteOptions): Promise<void> {
	const fs = await import("node:fs/promises");
	const { checkWsrtConfigJsonSchema, serializeWsrtConfigJsonSchema, wsrtConfigSchemaId } =
		await import("@wsrt/config");
	const contents = serializeWsrtConfigJsonSchema();
	const { fileURLToPath } = await import("node:url");
	const bundled = fileURLToPath(import.meta.resolve("@wsrt/config/schema"));
	if (options.check) {
		const existing = await fs.readFile(bundled, "utf8").catch(() => "");
		if (!checkWsrtConfigJsonSchema(existing).ok)
			throw new CommandLineError(`bundled configuration schema is stale: ${bundled}`);
		process.stdout.write(`Configuration schema is current: ${bundled}\n`);
		return;
	}
	if (options.output) {
		const destination = path.resolve(options.root ?? process.cwd(), options.output);
		await writeConfiguration(destination, contents, true);
		process.stdout.write(`Wrote WSRT configuration schema to ${destination}\n`);
		return;
	}
	if (options.stdout) {
		process.stdout.write(contents);
		return;
	}
	process.stdout.write(
		`WSRT Configuration Schema\nID: ${wsrtConfigSchemaId}\nInstalled: ${bundled}\nDraft: 2020-12\n`,
	);
}

async function convertConfig(
	positionalSource: string | undefined,
	options: ConfigWriteOptions,
): Promise<void> {
	const {
		configFileNames,
		configFormatFromPath,
		deriveConfigDestination,
		isConfigFormat,
		loadSystemDefinition,
		serializeConfig,
	} = await import("@wsrt/config");
	if (positionalSource && options.from)
		throw new CommandLineError("source was supplied both positionally and with `--from`");
	const root = path.resolve(options.root ?? process.cwd());
	const sourceOption = options.from ?? positionalSource ?? options.config;
	const loaded = await loadSystemDefinition(root, sourceOption);
	if (!loaded.file || !loaded.input) {
		const detail = loaded.diagnostics.map((item) => item.message).join("; ");
		if (!sourceOption)
			throw new CommandLineError(`${detail}. Searched: ${configFileNames.join(", ")}`);
		throw new CommandLineError(`${detail}: ${path.resolve(root, sourceOption)}`);
	}
	const requested = options.to?.toLowerCase();
	if (requested && !isConfigFormat(requested))
		throw new CommandLineError(
			`\`--to\` expects a supported format, received \`${options.to}\`; use \`--output\` for a path`,
		);
	const inferred = options.output ? configFormatFromPath(options.output) : undefined;
	if (options.output && !inferred)
		throw new CommandLineError(
			`cannot infer a supported configuration format from output path \`${options.output}\``,
		);
	if (requested && inferred && requested !== inferred)
		throw new CommandLineError(
			`format \`${requested}\` conflicts with output extension \`.${inferred}\``,
		);
	const format = (requested ?? inferred) as WsrtConfigFormat | undefined;
	if (!format) throw new CommandLineError("specify a destination with `--to` or `--output`");
	const destination = path.resolve(
		root,
		options.output ?? deriveConfigDestination(loaded.file, format),
	);
	if (destination === path.resolve(loaded.file))
		throw new CommandLineError(`source and destination resolve to the same file: ${destination}`);
	await writeConfiguration(destination, serializeConfig(loaded.input, { format }), !!options.force);
	const dynamic = /\.(?:[cm]?[jt]s)$/.test(loaded.file);
	process.stdout.write(
		`Converted ${loaded.file} to ${destination} (${format}); wrote the validated, normalized pipeline result${
			dynamic
				? " resolved from executable configuration; comments and source constructs were not preserved"
				: "; comments were not preserved"
		}.\n`,
	);
}

async function writeConfiguration(file: string, contents: string, force: boolean): Promise<void> {
	const fs = await import("node:fs/promises");
	await fs.mkdir(path.dirname(file), { recursive: true });
	try {
		await fs.writeFile(file, contents, force ? undefined : { flag: "wx" });
	} catch (cause) {
		if (!force && cause && typeof cause === "object" && "code" in cause && cause.code === "EEXIST")
			throw new CommandLineError(
				`destination already exists: ${file}. Use \`--force\` to overwrite it.`,
			);
		throw cause;
	}
}

async function discoverPluginCommands(
	argv: readonly string[],
): Promise<{ commands: readonly CliContribution[]; session?: PluginSession }> {
	const rootIndex = argv.findIndex((item) => item === "--root" || item === "-r");
	const configIndex = argv.findIndex((item) => item === "--config" || item === "-c");
	const root = rootIndex >= 0 && argv[rootIndex + 1] ? argv[rootIndex + 1] : undefined;
	const config = configIndex >= 0 && argv[configIndex + 1] ? argv[configIndex + 1] : undefined;
	const { loadSystemDefinition } = await import("@wsrt/config");
	const loaded = await loadSystemDefinition(root, config);
	if (!loaded.definition) return { commands: [] };
	const { PluginSession, resolveWorkspacePlugins } = await import("@wsrt/plugins");
	const plugins = await resolveWorkspacePlugins(loaded.definition.plugins, loaded.definition.root);
	const session = new PluginSession(plugins);
	const contributions = session.contributions("cli");
	const paths = new Set<string>();
	for (const contribution of contributions) {
		if (paths.has(contribution.path))
			throw new Error(`WSRT_PLUGIN_CLI_DUPLICATE: ${contribution.path}`);
		paths.add(contribution.path);
	}
	return { commands: contributions, session };
}

async function pluginContext(client: WorkspaceSessionClient): Promise<PluginContext> {
	const definition = await client.definition();
	return Object.freeze({
		root: client.session.workspaceRoot,
		configuration: definition,
		logger: {
			info: logger.info.bind(logger),
			warn: logger.warn.bind(logger),
			error: logger.error.bind(logger),
		},
		diagnostics: {
			add: (diagnostic) =>
				logger[diagnostic.severity === "warning" ? "warn" : diagnostic.severity](
					diagnostic.message,
				),
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
		services: Object.freeze({ workspaceSession: client }),
	});
}

function argumentsAfterPath(argv: readonly string[], commandPath: string): string[] {
	const parts = commandPath.split(/\s+/).filter(Boolean);
	for (let index = 0; index <= argv.length - parts.length; index++)
		if (parts.every((part, offset) => argv[index + offset] === part)) {
			const result = argv.slice(index + parts.length);
			return result[0] === "--" ? result.slice(1) : result;
		}
	return [];
}

function printResult(result: unknown, json: boolean): void {
	if (result !== undefined) {
		if (json) {
			process.stdout.write(`${JSON.stringify(result)}\n`);
			return;
		}
		logger.log(
			`wsrt ${process.argv.slice(2).join(" ")}`,
			result && typeof result === "object" ? (result as Record<string, unknown>) : { result },
		);
	}
}

function parseWorkspaceCommand(
	type: string,
	targets: readonly string[],
): WorkspacePlanRequest["command"] {
	if (["node.start", "node.stop", "node.restart"].includes(type)) {
		if (!targets.length) throw new CommandLineError(`${type} requires at least one node ID`);
		return { type: type as "node.start" | "node.stop" | "node.restart", nodeIds: targets };
	}
	if (type === "task.run" && targets.length === 1) return { type, taskId: targets[0] };
	if (type === "operation.cancel" && targets.length === 1) return { type, operationId: targets[0] };
	throw new CommandLineError(`unsupported command ${type} or invalid target count`);
}

function errorCode(cause: unknown): string {
	if (cause instanceof Error) {
		const match = cause.message.match(/\b(WSRT_[A-Z0-9_]+)\b/);
		if (match) return match[1];
		if (cause.name.startsWith("WSRT_")) return cause.name;
	}
	return "WSRT_INTERNAL_ERROR";
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
