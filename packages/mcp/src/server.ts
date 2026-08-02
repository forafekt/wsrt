import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { WsrtControlPlane } from "@wsrt/control-plane";
import type { WorkspaceSessionClient } from "@wsrt/workspace-session";
import { z } from "zod";
import { getMcpPrompt, readMcpResource, runMcpTool } from "./index.js";

const builtInTools = [
	"workspace.artifact",
	"workspace.artifacts",
	"workspace.cancel",
	"workspace.consumers",
	"workspace.dependencies",
	"workspace.diagnostics",
	"workspace.events",
	"workspace.graph",
	"workspace.node",
	"workspace.operation",
	"workspace.operations",
	"workspace.overview",
	"workspace.restart",
	"workspace.runTask",
	"workspace.snapshot",
	"workspace.start",
	"workspace.state",
	"workspace.stop",
] as const;

const packageMetadata = createRequire(import.meta.url)("../package.json") as {
	readonly name: string;
	readonly version: string;
};

export type WsrtMcpServerOptions = { readonly allowMutations?: boolean };

export class WsrtMcpServer {
	readonly server: McpServer;
	readonly #controllers = new Set<AbortController>();
	#closed = false;
	constructor(
		readonly controlPlane: WsrtControlPlane | WorkspaceSessionClient,
		readonly options: WsrtMcpServerOptions = {},
	) {
		this.server = new McpServer({
			name: "wsrt",
			version: packageMetadata.version,
		});
		this.#register();
	}
	async connect(transport: Transport): Promise<void> {
		if (this.#closed) throw coded("WSRT_MCP_SERVER_DISPOSED", "MCP server is disposed");
		await this.server.connect(transport);
	}
	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		for (const controller of this.#controllers)
			controller.abort(coded("WSRT_MCP_SERVER_DISPOSED", "MCP server closed"));
		this.#controllers.clear();
		await this.server.close();
	}
	#register() {
		if ("request" in this.controlPlane) this.#registerWorkspaceIntelligence(this.controlPlane);
		for (const name of builtInTools)
			this.server.registerTool(
				name,
				{
					description: `WSRT ${name}`,
					inputSchema: { input: z.record(z.unknown()).optional() },
					annotations: {
						readOnlyHint: ![
							"workspace.cancel",
							"workspace.restart",
							"workspace.runTask",
							"workspace.start",
							"workspace.stop",
						].includes(name),
					},
				},
				async ({ input }, extra) =>
					this.#invoke(extra.signal, async (signal) =>
						toolResult(
							await runMcpTool(
								this.controlPlane,
								{ tool: name, input },
								{ allowMutations: this.options.allowMutations, signal },
							),
						),
					),
			);

		for (const contribution of this.#contributions()) {
			const contributionName = `${contribution.pluginId}/${contribution.id}`;
			const name = transportName(contribution.pluginId, contribution.id);
			if (contribution.kind === "tool")
				this.server.registerTool(
					name,
					{
						description: contribution.description,
						inputSchema: { input: z.unknown().optional() },
						annotations: { readOnlyHint: !contribution.mutation },
					},
					async ({ input }, extra) =>
						this.#invoke(extra.signal, async (signal) =>
							toolResult(
								await runMcpTool(
									this.controlPlane,
									{
										tool: contributionName,
										input: isRecord(input) ? input : { value: input },
									},
									{ allowMutations: this.options.allowMutations, signal },
								),
							),
						),
				);
			else if (contribution.kind === "resource") {
				const uri = `wsrt://plugin/${encodeURIComponent(name)}`;
				this.server.registerResource(
					name,
					uri,
					{
						description: contribution.description,
						mimeType: "application/json",
					},
					async (_uri, extra) =>
						this.#invoke(extra.signal, async (signal) => ({
							contents: [
								{
									uri,
									mimeType: "application/json",
									text: stringify(
										await readMcpResource(this.controlPlane as WsrtControlPlane, contributionName, {
											signal,
										}),
									),
								},
							],
						})),
				);
			} else
				this.server.registerPrompt(
					name,
					{
						description: contribution.description,
						argsSchema: { input: z.string().optional() },
					},
					async ({ input }, extra) =>
						this.#invoke(extra.signal, async (signal) => {
							const result = await getMcpPrompt(
								this.controlPlane as WsrtControlPlane,
								contributionName,
								input,
								{
									signal,
								},
							);
							return promptResult(result);
						}),
				);
		}
	}
	#registerWorkspaceIntelligence(client: WorkspaceSessionClient) {
		const authority =
			"WSRT is authoritative for declared workspace architecture and live runtime state, not source-level symbol semantics. Read returned source files when implementation detail is needed.";
		this.server.registerTool(
			"wsrt_workspace_capabilities",
			{
				description: `Use before other WSRT workspace tools to discover supported protocol features and limits. ${authority}`,
				inputSchema: {},
				annotations: { readOnlyHint: true },
			},
			(_input, extra) =>
				this.#invoke(extra.signal, async (signal) =>
					toolResult(await client.getCapabilities({ signal })),
				),
		);
		this.server.registerTool(
			"wsrt_workspace_describe",
			{
				description: `Use for an evidence-backed architecture overview, projects, nodes, relationships, runtime references, and capabilities. Results may be broad; use node, graph, and files tools to narrow scope. ${authority}`,
				inputSchema: {},
				annotations: { readOnlyHint: true },
			},
			(_input, extra) =>
				this.#invoke(extra.signal, async (signal) =>
					toolResult(await client.describeWorkspace({ signal })),
				),
		);
		this.server.registerTool(
			"wsrt_workspace_get_started",
			{
				description: `Start here when unfamiliar with the workspace. Returns canonical-ID rules, recommended calls, query semantics, limitations, and authority boundaries. ${authority}`,
				inputSchema: {},
				annotations: { readOnlyHint: true },
			},
			(_input, extra) =>
				this.#invoke(extra.signal, async (signal) =>
					toolResult(await client.getStarted({ signal })),
				),
		);
		this.server.registerTool(
			"wsrt_node_describe",
			{
				description: `Use after workspace discovery to inspect one declared node, its live state, ownership, artifacts, operations, and evidence. It does not interpret source code; read associated files for implementation details. ${authority}`,
				inputSchema: {
					nodeId: z.string().min(1),
					aggregate: z.boolean().optional(),
					depth: z.number().int().min(1).max(32).optional(),
				},
				annotations: { readOnlyHint: true },
			},
			({ nodeId, aggregate, depth }, extra) =>
				this.#invoke(extra.signal, async (signal) =>
					toolResult(await client.describeNode(nodeId, { signal, aggregate, depth })),
				),
		);
		this.server.registerTool(
			"wsrt_nodes_query",
			{
				description: `List canonical workspace node IDs, kinds, names, aliases, and parent IDs before targeted queries. ${authority}`,
				inputSchema: {
					kinds: z.array(z.string().min(1)).optional(),
					limit: z.number().int().min(1).max(500).optional(),
					cursor: z.string().optional(),
				},
				annotations: { readOnlyHint: true },
			},
			({ kinds, limit, cursor }, extra) =>
				this.#invoke(extra.signal, async (signal) =>
					toolResult(
						await client.queryNodes(
							{
								...(kinds ? { kinds: kinds as never } : {}),
								...(limit !== undefined ? { limit } : {}),
								...(cursor ? { cursor } : {}),
							},
							{ signal },
						),
					),
				),
		);
		this.server.registerTool(
			"wsrt_graph_query",
			{
				description: `Use to scope dependencies or dependents from declared node IDs before broad repository exploration. Depth is limited to 32 and results to 500 nodes. Relationships are declared/evidence-backed, not inferred source symbols. ${authority}`,
				inputSchema: {
					roots: z.array(z.string().min(1)).min(1),
					direction: z.enum(["dependencies", "dependents", "both"]).optional(),
					depth: z.number().int().min(0).max(32).optional(),
					kinds: z.array(z.string().min(1)).optional(),
					limit: z.number().int().min(1).max(500).optional(),
				},
				annotations: { readOnlyHint: true },
			},
			({ roots, direction, depth, kinds, limit }, extra) =>
				this.#invoke(extra.signal, async (signal) =>
					toolResult(
						await client.queryGraph(
							{
								roots,
								...(direction ? { direction } : {}),
								...(depth !== undefined ? { depth } : {}),
								...(kinds ? { kinds: kinds as never } : {}),
								...(limit !== undefined ? { limit } : {}),
							},
							{ signal },
						),
					),
				),
		);
		this.server.registerTool(
			"wsrt_files_query",
			{
				description: `Use before broad file searches to find declared owners and source/configuration/test/generated associations. Results are paginated with a maximum page size of 500; generated files are excluded unless requested. Patterns identify declared scope and files still need to be read for contents. ${authority}`,
				inputSchema: {
					nodeIds: z.array(z.string().min(1)).optional(),
					projectIds: z.array(z.string().min(1)).optional(),
					roles: z.array(z.string().min(1)).optional(),
					paths: z.array(z.string().min(1)).optional(),
					includeGenerated: z.boolean().optional(),
					limit: z.number().int().min(1).max(500).optional(),
					cursor: z.string().optional(),
				},
				annotations: { readOnlyHint: true },
			},
			({ nodeIds, projectIds, roles, paths, includeGenerated, limit, cursor }, extra) =>
				this.#invoke(extra.signal, async (signal) =>
					toolResult(
						await client.queryFiles(
							{
								...(nodeIds ? { nodeIds } : {}),
								...(projectIds ? { projectIds } : {}),
								...(roles ? { roles: roles as never } : {}),
								...(paths ? { paths } : {}),
								...(includeGenerated !== undefined ? { includeGenerated } : {}),
								...(limit !== undefined ? { limit } : {}),
								...(cursor !== undefined ? { cursor } : {}),
							},
							{ signal },
						),
					),
				),
		);
		this.server.registerTool(
			"wsrt_change_impact",
			{
				description: `Use after identifying changed workspace-relative paths to find declared owners, dependent nodes/tasks, and recommended validations with evidence and confidence. It does not use Git history, ASTs, embeddings, or semantic code inference. ${authority}`,
				inputSchema: {
					paths: z.array(z.string().min(1)).min(1),
					expand: z
						.array(z.enum(["nodes", "projects", "tasks", "artifacts", "files", "evidence"]))
						.optional(),
				},
				annotations: { readOnlyHint: true },
			},
			({ paths, expand }, extra) =>
				this.#invoke(extra.signal, async (signal) =>
					toolResult(
						await client.analyzeChangeImpact({ paths, ...(expand ? { expand } : {}) }, { signal }),
					),
				),
		);
		this.server.registerTool(
			"wsrt_file_owners",
			{
				description: `Resolve direct and aggregate owners for one workspace-relative file through the authoritative workspace session. ${authority}`,
				inputSchema: { path: z.string().min(1) },
				annotations: { readOnlyHint: true },
			},
			({ path }, extra) =>
				this.#invoke(extra.signal, async (signal) =>
					toolResult(await client.fileOwners(path, { signal })),
				),
		);
		this.server.registerTool(
			"wsrt_validation_recommend",
			{
				description: `Recommend deterministically ordered validation tasks for changed workspace-relative files, with evidence and prerequisites. ${authority}`,
				inputSchema: { paths: z.array(z.string().min(1)).min(1) },
				annotations: { readOnlyHint: true },
			},
			({ paths }, extra) =>
				this.#invoke(extra.signal, async (signal) =>
					toolResult(await client.recommendValidation({ paths }, { signal })),
				),
		);
		this.server.registerTool(
			"wsrt_command_plan",
			{
				description: `Use before a lifecycle or task mutation to validate targets and inspect dependency actions, processes, resources, required permissions, risk, warnings, and provenance. This tool is read-only and never executes the command. ${authority}`,
				inputSchema: { command: z.record(z.unknown()) },
				annotations: { readOnlyHint: true },
			},
			({ command }, extra) =>
				this.#invoke(extra.signal, async (signal) =>
					toolResult(
						await client.planCommand(
							command as Parameters<WorkspaceSessionClient["planCommand"]>[0],
							{ signal },
						),
					),
				),
		);
		this.server.registerTool(
			"wsrt_command_execute",
			{
				description: `Use only after reviewing a command plan to execute an existing discriminated WSRT lifecycle/task/cancellation command. Generic shell execution is unsupported. Mutation access must be explicitly enabled, and the exact planned permission is sent to the host. ${authority}`,
				inputSchema: { command: z.record(z.unknown()) },
				annotations: { readOnlyHint: false, destructiveHint: true },
			},
			({ command }, extra) =>
				this.#invoke(extra.signal, async (signal) => {
					if (!this.options.allowMutations)
						throw coded("WSRT_MCP_PERMISSION_DENIED", "Workspace command execution is disabled");
					const parsed = command as Parameters<WorkspaceSessionClient["planCommand"]>[0];
					const plan = await client.planCommand(parsed, { signal });
					if (!plan.result.valid)
						throw coded("WSRT_MCP_COMMAND_INVALID", plan.result.warnings.join("; "));
					return toolResult(
						await client.executeWorkspaceCommand(parsed, {
							permissions: plan.result.requiredPermissions as never,
							expectedRevision: plan.metadata.workspaceRevision,
							signal,
						}),
					);
				}),
		);
	}
	#contributions() {
		if ("request" in this.controlPlane) return [];
		const plugins = this.controlPlane.snapshot().plugins;
		return this.controlPlane
			.pluginContributions("mcp")
			.map((contribution) => ({
				...contribution,
				pluginId: plugins.find((plugin) =>
					plugin.contributions.some((item) => item.kind === "mcp" && item.id === contribution.id),
				)?.id,
			}))
			.filter(
				(value): value is typeof value & { pluginId: string } => typeof value.pluginId === "string",
			)
			.sort((a, b) => `${a.pluginId}/${a.id}`.localeCompare(`${b.pluginId}/${b.id}`));
	}
	async #invoke<T>(
		requestSignal: AbortSignal,
		run: (signal: AbortSignal) => Promise<T>,
	): Promise<T> {
		if (this.#closed) throw coded("WSRT_MCP_SERVER_DISPOSED", "MCP server is disposed");
		const controller = new AbortController();
		const abort = () => controller.abort(requestSignal.reason);
		requestSignal.addEventListener("abort", abort, { once: true });
		this.#controllers.add(controller);
		try {
			const value = await run(controller.signal);
			if (controller.signal.aborted)
				throw controller.signal.reason ?? coded("WSRT_MCP_CANCELLED", "MCP invocation cancelled");
			return value;
		} finally {
			requestSignal.removeEventListener("abort", abort);
			this.#controllers.delete(controller);
		}
	}
}

function toolResult(value: unknown) {
	return {
		content: [{ type: "text" as const, text: stringify(value) }],
		...(isRecord(value) ? { structuredContent: value } : {}),
	};
}

function promptResult(value: unknown) {
	if (isRecord(value) && Array.isArray(value.messages)) return value as never;
	return {
		messages: [
			{
				role: "user" as const,
				content: { type: "text" as const, text: stringify(value) },
			},
		],
	};
}

function stringify(value: unknown): string {
	return typeof value === "string" ? value : JSON.stringify(value ?? null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function coded(code: string, message: string): Error {
	const error = new Error(`${code}: ${message}`);
	error.name = code;
	return error;
}

function transportName(pluginId: string, contributionId: string): string {
	return `${pluginId.replace(/[^A-Za-z0-9_.-]/g, "_")}.${contributionId.replace(/[^A-Za-z0-9_.-]/g, "_")}`;
}
