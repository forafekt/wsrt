import type { ControlPlaneCommand } from "@wsrt/control-plane";

export const WORKSPACE_PROTOCOL_VERSION = 1;
export const MAX_WORKSPACE_FRAME_BYTES = 8 * 1024 * 1024;

export type WorkspaceRequest =
	| { readonly type: "session.handshake" }
	| { readonly type: "session.status" }
	| { readonly type: "session.stop" }
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
	| { readonly type: "command.submit"; readonly command: ControlPlaneCommand }
	| { readonly type: "command.execute"; readonly command: ControlPlaneCommand };

export interface WorkspaceRequestEnvelope {
	readonly protocolVersion: number;
	readonly requestId: string;
	readonly request: WorkspaceRequest;
}

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
			if (isControlPlaneCommand(value.command)) return { type, command: value.command };
			break;
	}
	throw protocolError("protocol.malformed_request", `Malformed workspace request ${type}`);
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
