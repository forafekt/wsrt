import type { ControlPlaneCommand } from "@wsrt/control-plane";

export const WORKSPACE_PROTOCOL_VERSION = 1;
export const MAX_WORKSPACE_FRAME_BYTES = 8 * 1024 * 1024;

export type WorkspaceRequest =
	| { readonly type: "session.handshake" }
	| { readonly type: "session.status" }
	| { readonly type: "session.stop" }
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
	readonly hostVersion: string;
	readonly state: WorkspaceSessionState;
}

export type WorkspaceSessionState = "starting" | "ready" | "stopping" | "stopped" | "failed";

export function validateRequestEnvelope(value: unknown): WorkspaceRequestEnvelope {
	if (
		!isRecord(value) ||
		value.protocolVersion !== WORKSPACE_PROTOCOL_VERSION ||
		typeof value.requestId !== "string" ||
		!isRecord(value.request) ||
		typeof value.request.type !== "string"
	)
		throw protocolError("protocol.malformed_request", "Malformed workspace protocol request");
	return value as unknown as WorkspaceRequestEnvelope;
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
