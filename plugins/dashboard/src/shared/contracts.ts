import type { ControlPlaneSnapshot, WorkspaceEvent } from "@wsrt/control-plane";

export type DashboardSnapshot = Readonly<{
	protocolVersion: 3;
	protocol: DashboardProtocolDescriptor;
	revision: number;
	controlPlane: ControlPlaneSnapshot;
	graph: unknown;
	events: readonly WorkspaceEvent[];
	configuration: unknown;
}>;

export type DashboardProtocolDescriptor = Readonly<{
	transport: 1;
	snapshot: 3;
	contributions: 1;
	actions: 1;
	events: 1;
}>;

export const DASHBOARD_PROTOCOL: DashboardProtocolDescriptor = Object.freeze({
	transport: 1,
	snapshot: 3,
	contributions: 1,
	actions: 1,
	events: 1,
});

export type DashboardContributionView = Readonly<{
	id: string;
	kind:
		| "page"
		| "widget"
		| "panel"
		| "action"
		| "command"
		| "inspector"
		| "badge"
		| "graph-decoration"
		| "diagnostic-renderer"
		| "artifact-action"
		| "operation-action"
		| "event-renderer"
		| "metric-panel"
		| "status-item"
		| "navigation";
	title?: string;
	description?: string;
	target?: string;
	group?: string;
	order?: number;
	mutation?: boolean;
	refreshMs?: number;
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

export type DashboardProtocolError = Readonly<{
	error: { code: string; message: string; status: number };
}>;
