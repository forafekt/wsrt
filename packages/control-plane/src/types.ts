import type { ProcessHandle, RuntimeProvider } from "@wsrt/capabilities";
import type { SystemDiagnostic } from "@wsrt/config";
import type { SystemNode } from "@wsrt/graph";
import type { LifecycleEvent, LifecycleState } from "@wsrt/lifecycle";
import type { PersistenceProvider } from "@wsrt/persistence";
import type { PluginSession, PluginSnapshot } from "@wsrt/plugins";

export type WorkspaceEvent =
	| LifecycleEvent
	| {
			id: string;
			type: string;
			timestamp: string;
			source: string;
			correlationId: string;
			payload: unknown;
	  };

export type ArtifactRecord = {
	id: string;
	type: string;
	producer?: string;
	consumers: readonly string[];
	location?: string;
	status: "pending" | "invalid" | "generating" | "ready" | "unchanged" | "failed";
	hash?: string;
	size?: number;
	createdAt?: string;
	updatedAt?: string;
	invalidatedAt?: string;
	sourceOperationId?: string;
	diagnostics?: readonly SystemDiagnostic[];
	metadata: Readonly<Record<string, unknown>>;
};

export type OperationResult = {
	operationId: string;
	nodes: readonly string[];
	states: Readonly<Record<string, LifecycleState>>;
	status: "completed" | "partially-completed" | "failed" | "cancelled";
	results: readonly NodeOperationResult[];
};

export type SubmittedOperation = {
	operationId: string;
	nodes: readonly string[];
	status: "accepted";
};

export type ControlPlaneCommand =
	| { type: "node.start"; nodeIds: readonly string[] }
	| { type: "node.stop"; nodeIds: readonly string[] }
	| { type: "node.restart"; nodeIds: readonly string[] }
	| { type: "task.run"; taskId: string }
	| { type: "operation.cancel"; operationId: string };

export const controlPlaneCommandPermissions = Object.freeze([
	"nodes.start",
	"nodes.stop",
	"nodes.restart",
	"tasks.run",
	"operations.cancel",
] as const);

export type ControlPlaneCommandPermission = (typeof controlPlaneCommandPermissions)[number];

export function controlPlaneCommandPermission(
	command: ControlPlaneCommand,
): ControlPlaneCommandPermission {
	if (command.type === "node.start") return "nodes.start";
	if (command.type === "node.stop") return "nodes.stop";
	if (command.type === "node.restart") return "nodes.restart";
	if (command.type === "task.run") return "tasks.run";
	return "operations.cancel";
}

export type ControlPlaneCommandResult =
	| OperationResult
	| { operationId: string; cancelled: boolean };

export type SerializedControlPlaneError = Readonly<{
	code: string;
	message: string;
	details?: Readonly<Record<string, unknown>>;
}>;

export class ControlPlaneError extends Error {
	readonly name = "ControlPlaneError";

	constructor(
		readonly code: string,
		message: string,
		readonly details?: Readonly<Record<string, unknown>>,
	) {
		super(message);
	}
}

export function serializeControlPlaneError(cause: unknown): SerializedControlPlaneError {
	if (cause instanceof ControlPlaneError)
		return {
			code: cause.code,
			message: cause.message,
			...(cause.details ? { details: cause.details } : {}),
		};
	return {
		code: "control_plane.internal",
		message: cause instanceof Error ? cause.message : String(cause),
	};
}

export type NodeOperationResult = {
	nodeId: string;
	status:
		| "completed"
		| "already-satisfied"
		| "blocked"
		| "failed"
		| "cancelled"
		| "rolled-back"
		| "cleanup-failed";
	changed: boolean;
	diagnostics: readonly SystemDiagnostic[];
};

export type HealthState = "unknown" | "checking" | "healthy" | "degraded" | "unhealthy";

export type OperationSnapshot = {
	id: string;
	type: "start" | "stop" | "restart" | "task" | "dispose";
	status: "pending" | "running" | "completed" | "partially-completed" | "failed" | "cancelled";
	requestedNodes: readonly string[];
	affectedNodes: readonly string[];
	startedAt?: string;
	completedAt?: string;
	correlationId: string;
	diagnostics: readonly SystemDiagnostic[];
	results: readonly NodeOperationResult[];
};

export type NodeSnapshot = {
	id: string;
	kind: SystemNode["kind"];
	state: LifecycleState;
	health: HealthState;
	runtime?: string;
	pid?: number;
	terminationState?: ProcessHandle["terminationState"];
	restartCount: number;
	consecutiveSuccesses: number;
	consecutiveFailures: number;
	lastCheckAt?: string;
	lastSuccessfulCheckAt?: string;
	lastFailedCheckAt?: string;
	lastHealthDiagnostic?: string;
	healthProviderId?: string;
	exit?: {
		code: number | null;
		signal: string | null;
		timestamp: string;
		expected: boolean;
		duringManualStop: boolean;
	};
	restartPending: boolean;
	currentRestartAttempt: number;
	nextRestartAt?: string;
};

export type ControlPlaneSnapshot = {
	revision: number;
	generatedAt: string;
	workspace: { name: string; root: string };
	nodes: readonly NodeSnapshot[];
	operations: readonly OperationSnapshot[];
	artifacts: readonly ArtifactRecord[];
	diagnostics: readonly SystemDiagnostic[];
	events: { size: number };
	plugins: readonly PluginSnapshot[];
	providers: readonly { id: string; kind: "runtime" }[];
};

export type ControlPlaneOptions = {
	root?: string;
	config?: string;
	providers?: RuntimeProvider[];
	allowMutations?: boolean;
	pluginSession?: PluginSession;
	/** Overrides normalized configuration. Use `false` for an ephemeral control plane. */
	persistence?: PersistenceProvider | false;
};
