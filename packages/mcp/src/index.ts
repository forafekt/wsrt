import type { WsrtControlPlane } from "@wsrt/control-plane";
export type McpRequest = { tool: string; input?: Record<string, unknown> };
export async function runMcpTool(
	controlPlane: WsrtControlPlane,
	request: McpRequest,
	options: { allowMutations?: boolean } = {},
): Promise<unknown> {
	const input = request.input ?? {};
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
			return controlPlane
				.snapshot()
				.nodes.find((node) => node.id === String(input.id ?? ""));
		case "workspace.events":
			return controlPlane.listEvents();
		case "workspace.artifacts":
			return controlPlane.listArtifacts();
		case "workspace.artifact":
			return controlPlane
				.listArtifacts()
				.find((item) => item.id === String(input.id ?? ""));
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
function mutation(options: { allowMutations?: boolean }) {
	if (!options.allowMutations)
		throw new Error("MCP mutating operations are disabled");
}
function ids(input: Record<string, unknown>): string[] {
	return Array.isArray(input.ids)
		? input.ids.map(String)
		: typeof input.id === "string"
			? [input.id]
			: [];
}
