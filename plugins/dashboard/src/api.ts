import type { WsrtControlPlane } from "@wsrt/control-plane";
export function dashboardSnapshot(plane: WsrtControlPlane) {
	const snapshot = plane.snapshot();
	return {
		protocolVersion: 3 as const,
		revision: snapshot.revision,
		controlPlane: snapshot,
		graph: plane.graph().toJSON(),
		events: plane.listEvents(),
		configuration: plane.definition(),
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
	if (ids.length !== 1) throw new Error("Task operation requires exactly one task");
	return plane.runTask(ids[0]);
}
export function dashboardCancelOperation(plane: WsrtControlPlane, operationId: string) {
	return { operationId, cancelled: plane.cancelOperation(operationId) };
}
