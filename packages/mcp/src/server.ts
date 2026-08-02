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
