import type { WsrtControlPlane } from "@wsrt/control-plane";
export function dashboardSnapshot(plane: WsrtControlPlane) {
	return {
		overview: {
			name: plane.definition().name,
			root: plane.definition().root,
			nodes: plane.graph().nodes().length,
			events: plane.listEvents().length,
			artifacts: plane.listArtifacts().length,
		},
		graph: plane.graph().toJSON(),
		nodes: plane
			.graph()
			.nodes()
			.map((node) => ({ ...node, state: plane.getNodeState(node.id) })),
		events: plane.listEvents(),
		diagnostics: plane.validate(),
		artifacts: plane.listArtifacts(),
	};
}
export async function dashboardOperation(
	plane: WsrtControlPlane,
	operation: "start" | "stop" | "restart" | "run",
	ids: string[],
) {
	if (operation === "start") return plane.start(ids);
	if (operation === "stop") return plane.stop(ids);
	if (operation === "restart") return plane.restart(ids);
	if (ids.length !== 1)
		throw new Error("Task operation requires exactly one task");
	return plane.runTask(ids[0]);
}
