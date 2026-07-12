import type { ControlPlaneSnapshot, WorkspaceEvent } from "@wsrt/control-plane";

export type DashboardSnapshot = Readonly<{
	revision: number;
	controlPlane: ControlPlaneSnapshot;
	graph: unknown;
	events: readonly WorkspaceEvent[];
	configuration: unknown;
}>;
export type DashboardRoute =
	| "overview"
	| "graph"
	| "nodes"
	| "operations"
	| "tasks"
	| "artifacts"
	| "events"
	| "diagnostics"
	| "health"
	| "plugins"
	| "providers"
	| "configuration";
export type DashboardOperationRequest = {
	operation: "start" | "stop" | "restart" | "run";
	ids: readonly string[];
};
export type DashboardCancellationResult = {
	operationId: string;
	cancelled: boolean;
};
