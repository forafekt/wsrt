import type { WsrtControlPlane } from "@wsrt/control-plane";
import type { WorkspaceSessionClient } from "@wsrt/workspace-session";

export type McpRequest = { tool: string; input?: Record<string, unknown> };

export async function runMcpTool(
	controlPlane: WsrtControlPlane | WorkspaceSessionClient,
	request: McpRequest,
	options: { allowMutations?: boolean; signal?: AbortSignal } = {},
): Promise<unknown> {
	const input = request.input ?? {};
	if ("request" in controlPlane)
		return runSessionTool(controlPlane as WorkspaceSessionClient, request.tool, input, options);
	const contributed = controlPlane
		.pluginContributions("mcp")
		.find(
			(item) =>
				item.kind === "tool" &&
				`${controlPlane.snapshot().plugins.find((plugin) => plugin.contributions.some((value) => value.kind === "mcp" && value.id === item.id))?.id}/${item.id}` ===
					request.tool,
		);
	if (contributed) {
		if (contributed.mutation) mutation(options);
		const diagnostics = contributed.validate?.(input) ?? [];
		if (diagnostics.some((item) => item.severity === "error"))
			throw new Error(diagnostics.map((item) => item.message).join("\n"));
		return controlPlane.invokePluginContribution("mcp", contributed.id, (context) =>
			contributed.run(input, context, options.signal ?? new AbortController().signal),
		);
	}
	switch (request.tool) {
		case "workspace.overview":
			return {
				name: controlPlane.definition().name,
				root: controlPlane.definition().root,
				nodes: controlPlane.graph().nodes().length,
				artifacts: controlPlane.listArtifacts().length,
				diagnostics: controlPlane.validate().length,
			};
		case "workspace.graph":
			return controlPlane.graph().toJSON();
		case "workspace.snapshot":
			return controlPlane.snapshot();
		case "workspace.operations":
			return controlPlane.listOperations();
		case "workspace.operation":
			return controlPlane.getOperation(String(input.id ?? ""));
		case "workspace.node":
			return controlPlane.getNode(String(input.id ?? ""));
		case "workspace.dependencies":
			return controlPlane.getDependencies(String(input.id ?? ""));
		case "workspace.consumers":
			return controlPlane.getConsumers(String(input.id ?? ""));
		case "workspace.diagnostics":
			return controlPlane.validate();
		case "workspace.state":
			return controlPlane.snapshot().nodes.find((node) => node.id === String(input.id ?? ""));
		case "workspace.events":
			return controlPlane.listEvents();
		case "workspace.artifacts":
			return controlPlane.listArtifacts();
		case "workspace.artifact":
			return controlPlane.listArtifacts().find((item) => item.id === String(input.id ?? ""));
		case "workspace.cancel":
			mutation(options);
			return {
				operationId: String(input.id ?? ""),
				cancelled: controlPlane.cancelOperation(String(input.id ?? "")),
			};
		case "workspace.start":
			mutation(options);
			return controlPlane.start(ids(input));
		case "workspace.stop":
			mutation(options);
			return controlPlane.stop(ids(input));
		case "workspace.restart":
			mutation(options);
			return controlPlane.restart(ids(input));
		case "workspace.runTask":
			mutation(options);
			return controlPlane.runTask(String(input.id ?? ""));
		default:
			throw new Error(`Unknown MCP tool: ${request.tool}`);
	}
}

async function runSessionTool(
	client: WorkspaceSessionClient,
	tool: string,
	input: Record<string, unknown>,
	options: { allowMutations?: boolean },
): Promise<unknown> {
	const snapshot = async () => client.snapshot();
	switch (tool) {
		case "workspace.overview": {
			const value = await snapshot();
			return {
				name: value.workspace.name,
				root: value.workspace.root,
				nodes: value.nodes.length,
				artifacts: value.artifacts.length,
				diagnostics: value.diagnostics.length,
			};
		}
		case "workspace.graph":
			return client.graph();
		case "workspace.snapshot":
			return snapshot();
		case "workspace.operations":
			return client.operations();
		case "workspace.operation":
			return (await client.operations()).find((item) => item.id === String(input.id ?? ""));
		case "workspace.node":
		case "workspace.state":
			return (await snapshot()).nodes.find((item) => item.id === String(input.id ?? ""));
		case "workspace.dependencies":
			return graphRelations(await client.graph(), String(input.id ?? ""), "to");
		case "workspace.consumers":
			return graphRelations(await client.graph(), String(input.id ?? ""), "from");
		case "workspace.diagnostics":
			return client.diagnostics();
		case "workspace.events":
			return client.events();
		case "workspace.artifacts":
			return client.artifacts();
		case "workspace.artifact":
			return (await client.artifacts()).find((item) => item.id === String(input.id ?? ""));
		case "workspace.cancel":
			mutation(options);
			return client.execute({ type: "operation.cancel", operationId: String(input.id ?? "") });
		case "workspace.start":
			mutation(options);
			return client.execute({ type: "node.start", nodeIds: ids(input) });
		case "workspace.stop":
			mutation(options);
			return client.execute({ type: "node.stop", nodeIds: ids(input) });
		case "workspace.restart":
			mutation(options);
			return client.execute({ type: "node.restart", nodeIds: ids(input) });
		case "workspace.runTask":
			mutation(options);
			return client.execute({ type: "task.run", taskId: String(input.id ?? "") });
		default:
			throw new Error(`Unknown MCP tool: ${tool}`);
	}
}

function graphRelations(value: unknown, id: string, direction: "from" | "to"): unknown[] {
	if (!value || typeof value !== "object" || !("edges" in value) || !Array.isArray(value.edges))
		return [];
	return value.edges.filter(
		(edge) =>
			edge &&
			typeof edge === "object" &&
			direction in edge &&
			(edge as Record<string, unknown>)[direction] === id,
	);
}

export async function readMcpResource(
	controlPlane: WsrtControlPlane,
	id: string,
	options: { signal?: AbortSignal } = {},
): Promise<unknown> {
	return runContribution(controlPlane, "resource", id, undefined, options.signal);
}

export async function getMcpPrompt(
	controlPlane: WsrtControlPlane,
	id: string,
	input?: unknown,
	options: { signal?: AbortSignal } = {},
): Promise<unknown> {
	return runContribution(controlPlane, "prompt", id, input, options.signal);
}

async function runContribution(
	controlPlane: WsrtControlPlane,
	kind: "resource" | "prompt",
	id: string,
	input: unknown,
	signal?: AbortSignal,
) {
	const plugin = controlPlane
		.snapshot()
		.plugins.find((item) =>
			item.contributions.some(
				(contribution) =>
					contribution.kind === "mcp" && contribution.id === id.slice(item.id.length + 1),
			),
		);
	const contributionId = plugin ? id.slice(plugin.id.length + 1) : id;
	const contribution = controlPlane
		.pluginContributions("mcp")
		.find((item) => item.kind === kind && item.id === contributionId);
	if (!contribution || !plugin) throw new Error(`Unknown MCP ${kind}: ${id}`);
	return controlPlane.invokePluginContribution("mcp", contribution.id, (context) =>
		contribution.run(input, context, signal ?? new AbortController().signal),
	);
}

function mutation(options: { allowMutations?: boolean }) {
	if (!options.allowMutations)
		throw new Error("WSRT_MCP_PERMISSION_DENIED: MCP mutating operations are disabled");
}

function ids(input: Record<string, unknown>): string[] {
	return Array.isArray(input.ids)
		? input.ids.map(String)
		: typeof input.id === "string"
			? [input.id]
			: [];
}

export {
	WsrtMcpServer,
	type WsrtMcpServerOptions,
} from "./server.js";
