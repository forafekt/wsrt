import {
	type ControlPlaneCommand,
	type ControlPlaneCommandResult,
	controlPlaneCommandPermissions,
} from "@wsrt/control-plane";
import type {
	ChangeImpactQuery,
	ChangeImpactResult,
	CommandPlan,
	FileQuery,
	FileQueryResult,
	GraphQuery,
	GraphQueryResult,
	WorkspaceCapability,
	WorkspaceIntelligenceSnapshot,
	WorkspaceNodeDescription,
} from "@wsrt/workspace-intelligence";

export const WORKSPACE_PROTOCOL_VERSION = 1;

export const MAX_WORKSPACE_FRAME_BYTES = 8 * 1024 * 1024;

export const workspacePermissions = Object.freeze([
	"workspace.read",
	"runtime.read",
	"logs.read",
	"diagnostics.read",
	"commands.plan",
	...controlPlaneCommandPermissions,
] as const);

export type WorkspacePermission = (typeof workspacePermissions)[number];

export type WorkspaceRequest =
	| { readonly type: "session.handshake" }
	| { readonly type: "session.status" }
	| { readonly type: "session.stop" }
	| { readonly type: "workspace.capabilities"; readonly expectedRevision?: number }
	| { readonly type: "workspace.describe"; readonly expectedRevision?: number }
	| {
			readonly type: "workspace.node.describe";
			readonly nodeId: string;
			readonly expectedRevision?: number;
	  }
	| {
			readonly type: "workspace.graph.query";
			readonly query: GraphQuery;
			readonly expectedRevision?: number;
	  }
	| {
			readonly type: "workspace.files.query";
			readonly query: FileQuery;
			readonly expectedRevision?: number;
	  }
	| {
			readonly type: "workspace.change.impact";
			readonly query: ChangeImpactQuery;
			readonly expectedRevision?: number;
	  }
	| {
			readonly type: "workspace.command.plan";
			readonly command: ControlPlaneCommand;
			readonly permissions?: readonly WorkspacePermission[];
			readonly expectedRevision?: number;
	  }
	| {
			readonly type: "workspace.command.execute";
			readonly command: ControlPlaneCommand;
			readonly permissions?: readonly WorkspacePermission[];
			readonly expectedRevision?: number;
	  }
	| { readonly type: "request.cancel"; readonly targetRequestId: string }
	| { readonly type: "lease.acquire"; readonly kind: WorkspaceClientLease["kind"] }
	| { readonly type: "lease.renew"; readonly leaseId: string }
	| { readonly type: "lease.release"; readonly leaseId: string }
	| { readonly type: "dashboard.action.list" }
	| {
			readonly type: "dashboard.action.invoke";
			readonly actionId: string;
			readonly input?: unknown;
	  }
	| { readonly type: "subscription.start"; readonly afterRevision?: number }
	| { readonly type: "snapshot.get" }
	| { readonly type: "definition.get" }
	| { readonly type: "operations.get" }
	| { readonly type: "events.get"; readonly afterRevision?: number }
	| { readonly type: "artifacts.get" }
	| { readonly type: "diagnostics.get" }
	| { readonly type: "graph.get" }
	| { readonly type: "plugins.get" }
	| { readonly type: "completion.get"; readonly input: string }
	| {
			readonly type: "command.submit";
			readonly command: ControlPlaneCommand;
			readonly permissions?: readonly WorkspacePermission[];
	  }
	| {
			readonly type: "command.execute";
			readonly command: ControlPlaneCommand;
			readonly permissions?: readonly WorkspacePermission[];
	  };

export interface WorkspaceRequestEnvelope {
	readonly protocolVersion: number;
	readonly requestId: string;
	readonly request: WorkspaceRequest;
}

export type WorkspaceResponseMetadata = Readonly<{
	protocolVersion: typeof WORKSPACE_PROTOCOL_VERSION;
	workspaceRevision: number;
	generatedAt: string;
	requestId: string;
}>;

export type WorkspaceOperationResponse<T> = Readonly<{
	metadata: WorkspaceResponseMetadata;
	result: T;
}>;

export type WorkspaceCapabilitiesResponse = WorkspaceOperationResponse<
	readonly WorkspaceCapability[]
>;

export type WorkspaceDescribeResponse = WorkspaceOperationResponse<WorkspaceIntelligenceSnapshot>;

export type WorkspaceNodeDescribeResponse = WorkspaceOperationResponse<WorkspaceNodeDescription>;

export type WorkspaceGraphQueryResponse = WorkspaceOperationResponse<GraphQueryResult>;

export type WorkspaceFilesQueryResponse = WorkspaceOperationResponse<FileQueryResult>;

export type WorkspaceChangeImpactResponse = WorkspaceOperationResponse<ChangeImpactResult>;

export type WorkspaceCommandPlanResponse = WorkspaceOperationResponse<CommandPlan>;

export type WorkspaceCommandExecuteResponse = WorkspaceOperationResponse<ControlPlaneCommandResult>;

export type WorkspaceProtocolError = Readonly<{
	code: string;
	message: string;
	details?: Readonly<Record<string, unknown>>;
}>;

export type WorkspaceResponseEnvelope =
	| {
			readonly protocolVersion: number;
			readonly requestId: string;
			readonly ok: true;
			readonly result: unknown;
	  }
	| {
			readonly protocolVersion: number;
			readonly requestId: string;
			readonly ok: false;
			readonly error: WorkspaceProtocolError;
	  };

export type WorkspaceSessionEvent =
	| { readonly type: "snapshot.updated"; readonly revision: number; readonly snapshot: unknown }
	| {
			readonly type: "workspace.revision.changed";
			readonly previousRevision: number;
			readonly revision: number;
	  }
	| { readonly type: "workspace.node.changed"; readonly revision: number; readonly node: unknown }
	| {
			readonly type: "workspace.operation.changed";
			readonly revision: number;
			readonly operation: unknown;
	  }
	| {
			readonly type: "workspace.diagnostic.added";
			readonly revision: number;
			readonly diagnostic: unknown;
	  }
	| {
			readonly type: "workspace.artifact.changed";
			readonly revision: number;
			readonly artifact: unknown;
	  }
	| {
			readonly type: "workspace.capabilities.changed";
			readonly revision: number;
			readonly capabilities: readonly WorkspaceCapability[];
	  }
	| { readonly type: "session.closing"; readonly reason: string };

export interface WorkspaceEventEnvelope {
	readonly protocolVersion: number;
	readonly sessionId: string;
	readonly event: WorkspaceSessionEvent;
}

export interface WorkspaceSessionHandshake {
	readonly protocolVersion: number;
	readonly minimumClientProtocolVersion: number;
	readonly sessionId: string;
	readonly workspaceId: string;
	readonly workspaceRoot: string;
	readonly pid: number;
	readonly processStartedAt: string;
	readonly processExecutable?: string;
	readonly hostVersion: string;
	readonly state: WorkspaceSessionState;
}

export interface WorkspaceClientLease {
	readonly id: string;
	readonly kind: "dashboard" | "mcp" | "ide" | "other";
	readonly acquiredAt: string;
	readonly expiresAt: string;
}

export interface DashboardActionDescriptor {
	readonly id: string;
	readonly pluginId: string;
	readonly title: string;
	readonly description?: string;
}

export type WorkspaceSessionState = "starting" | "ready" | "stopping" | "stopped" | "failed";

export function validateRequestEnvelope(value: unknown): WorkspaceRequestEnvelope {
	if (
		!isRecord(value) ||
		value.protocolVersion !== WORKSPACE_PROTOCOL_VERSION ||
		typeof value.requestId !== "string" ||
		!isRecord(value.request)
	)
		throw protocolError("protocol.malformed_request", "Malformed workspace protocol request");
	return {
		protocolVersion: WORKSPACE_PROTOCOL_VERSION,
		requestId: value.requestId,
		request: validateWorkspaceRequest(value.request),
	};
}

function validateWorkspaceRequest(value: Record<string, unknown>): WorkspaceRequest {
	const type = value.type;
	if (typeof type !== "string")
		throw protocolError("protocol.malformed_request", "Workspace request type is missing");
	switch (type) {
		case "session.handshake":
		case "session.status":
		case "session.stop":
		case "snapshot.get":
		case "definition.get":
		case "operations.get":
		case "artifacts.get":
		case "diagnostics.get":
		case "graph.get":
		case "plugins.get":
		case "dashboard.action.list":
			return { type };
		case "workspace.capabilities":
		case "workspace.describe":
			return { type, ...expectedRevision(value) };
		case "workspace.node.describe":
			if (typeof value.nodeId === "string" && value.nodeId)
				return { type, nodeId: value.nodeId, ...expectedRevision(value) };
			break;
		case "workspace.graph.query":
			return { type, query: validateGraphQuery(value.query), ...expectedRevision(value) };
		case "workspace.files.query":
			return { type, query: validateFileQuery(value.query), ...expectedRevision(value) };
		case "workspace.change.impact":
			return { type, query: validateChangeImpactQuery(value.query), ...expectedRevision(value) };
		case "workspace.command.plan":
			if (isControlPlaneCommand(value.command))
				return { type, command: value.command, ...permissions(value), ...expectedRevision(value) };
			break;
		case "workspace.command.execute":
			if (isControlPlaneCommand(value.command))
				return { type, command: value.command, ...permissions(value), ...expectedRevision(value) };
			break;
		case "subscription.start":
			return {
				type,
				...(typeof value.afterRevision === "number" ? { afterRevision: value.afterRevision } : {}),
			};
		case "events.get":
			return {
				type,
				...(typeof value.afterRevision === "number" ? { afterRevision: value.afterRevision } : {}),
			};
		case "completion.get":
			if (typeof value.input === "string") return { type, input: value.input };
			break;
		case "request.cancel":
			if (typeof value.targetRequestId === "string")
				return { type, targetRequestId: value.targetRequestId };
			break;
		case "lease.acquire":
			if (["dashboard", "mcp", "ide", "other"].includes(String(value.kind)))
				return { type, kind: value.kind as WorkspaceClientLease["kind"] };
			break;
		case "lease.renew":
		case "lease.release":
			if (typeof value.leaseId === "string") return { type, leaseId: value.leaseId };
			break;
		case "dashboard.action.invoke":
			if (typeof value.actionId === "string")
				return {
					type,
					actionId: value.actionId,
					...(value.input !== undefined ? { input: value.input } : {}),
				};
			break;
		case "command.submit":
		case "command.execute":
			if (isControlPlaneCommand(value.command))
				return { type, command: value.command, ...permissions(value) };
			break;
	}
	throw protocolError("protocol.malformed_request", `Malformed workspace request ${type}`);
}

function permissions(value: Record<string, unknown>): {
	permissions?: readonly WorkspacePermission[];
} {
	if (value.permissions === undefined) return {};
	if (
		Array.isArray(value.permissions) &&
		value.permissions.every((item) => workspacePermissions.includes(item as WorkspacePermission))
	)
		return { permissions: value.permissions as WorkspacePermission[] };
	throw protocolError(
		"protocol.malformed_request",
		"permissions contains an unsupported permission",
	);
}

function expectedRevision(value: Record<string, unknown>): { expectedRevision?: number } {
	if (value.expectedRevision === undefined) return {};
	if (Number.isInteger(value.expectedRevision) && (value.expectedRevision as number) >= 0)
		return { expectedRevision: value.expectedRevision as number };
	throw protocolError(
		"protocol.malformed_request",
		"expectedRevision must be a non-negative integer",
	);
}

function validateGraphQuery(value: unknown): GraphQuery {
	if (!isRecord(value) || !Array.isArray(value.roots) || !value.roots.every(nonEmptyString))
		throw protocolError(
			"protocol.malformed_request",
			"Graph query roots must be an array of node IDs",
		);
	if (
		value.direction !== undefined &&
		!["dependencies", "dependents", "both"].includes(String(value.direction))
	)
		throw protocolError("protocol.malformed_request", "Invalid graph query direction");
	if (value.depth !== undefined && !Number.isInteger(value.depth))
		throw protocolError("protocol.malformed_request", "Graph query depth must be an integer");
	if (value.limit !== undefined && !Number.isInteger(value.limit))
		throw protocolError("protocol.malformed_request", "Graph query limit must be an integer");
	if (
		value.kinds !== undefined &&
		(!Array.isArray(value.kinds) || !value.kinds.every(nonEmptyString))
	)
		throw protocolError(
			"protocol.malformed_request",
			"Graph query kinds must be an array of node kinds",
		);
	return {
		roots: value.roots as string[],
		...(value.direction ? { direction: value.direction as GraphQuery["direction"] } : {}),
		...(value.depth !== undefined ? { depth: value.depth as number } : {}),
		...(value.limit !== undefined ? { limit: value.limit as number } : {}),
		...(value.kinds ? { kinds: value.kinds as GraphQuery["kinds"] } : {}),
	};
}

function validateFileQuery(value: unknown): FileQuery {
	if (!isRecord(value))
		throw protocolError("protocol.malformed_request", "File query must be an object");
	for (const key of ["nodeIds", "projectIds", "roles", "paths"])
		if (
			value[key] !== undefined &&
			(!Array.isArray(value[key]) || !(value[key] as unknown[]).every(nonEmptyString))
		)
			throw protocolError(
				"protocol.malformed_request",
				`File query ${key} must be an array of strings`,
			);
	if (value.includeGenerated !== undefined && typeof value.includeGenerated !== "boolean")
		throw protocolError("protocol.malformed_request", "includeGenerated must be a boolean");
	if (value.limit !== undefined && !Number.isInteger(value.limit))
		throw protocolError("protocol.malformed_request", "File query limit must be an integer");
	if (value.cursor !== undefined && typeof value.cursor !== "string")
		throw protocolError("protocol.malformed_request", "File query cursor must be a string");
	return value as FileQuery;
}

function validateChangeImpactQuery(value: unknown): ChangeImpactQuery {
	if (
		!isRecord(value) ||
		!Array.isArray(value.paths) ||
		value.paths.length === 0 ||
		!value.paths.every(nonEmptyString)
	)
		throw protocolError(
			"protocol.malformed_request",
			"Change impact paths must be an array of paths",
		);
	return { paths: value.paths };
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isControlPlaneCommand(value: unknown): value is ControlPlaneCommand {
	if (!isRecord(value) || typeof value.type !== "string") return false;
	if (["node.start", "node.stop", "node.restart"].includes(value.type))
		return Array.isArray(value.nodeIds) && value.nodeIds.every((item) => typeof item === "string");
	if (value.type === "task.run") return typeof value.taskId === "string";
	return value.type === "operation.cancel" && typeof value.operationId === "string";
}

export function protocolError(
	code: string,
	message: string,
	details?: Readonly<Record<string, unknown>>,
): Error & { code: string; details?: Readonly<Record<string, unknown>> } {
	return Object.assign(new Error(message), { code, ...(details ? { details } : {}) });
}

export function structuredError(cause: unknown): WorkspaceProtocolError {
	if (isRecord(cause) && typeof cause.code === "string" && typeof cause.message === "string")
		return {
			code: cause.code,
			message: cause.message,
			...(isRecord(cause.details) ? { details: cause.details } : {}),
		};
	return {
		code: "session.internal",
		message: cause instanceof Error ? cause.message : String(cause),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
