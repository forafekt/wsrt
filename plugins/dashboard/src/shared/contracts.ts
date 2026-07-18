import type { ControlPlaneSnapshot, WorkspaceEvent } from "@wsrt/control-plane";

export type DashboardSnapshot = Readonly<{
	revision: number;
	controlPlane: ControlPlaneSnapshot;
	graph: unknown;
	events: readonly WorkspaceEvent[];
	configuration: unknown;
}>;
export type DashboardContributionView = Readonly<{
	id: string;
	kind: "page" | "widget" | "panel" | "action";
	title?: string;
	data?: unknown;
	error?: string;
}>;
export type DashboardRoute =
	| "overview"
	| "workspace"
	| "graph"
	| "nodes"
	| "operations"
	| "tasks"
	| "artifacts"
	| "events"
	| "logs"
	| "diagnostics"
	| "health"
	| "plugins"
	| "providers"
	| "configuration"
	| "metrics"
	| "timeline"
	| "settings"
	| `ext:${string}`;
export type DashboardOperationRequest = {
	operation: "start" | "stop" | "restart" | "run";
	ids: readonly string[];
};
export type DashboardCancellationResult = {
	operationId: string;
	cancelled: boolean;
};
