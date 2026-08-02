import type { ProcessIdentity, ProcessIdentityProvider } from "./process-identity.js";
import { WORKSPACE_PROTOCOL_VERSION, type WorkspaceSessionHandshake } from "./protocol.js";
import type { WorkspaceSessionRecord } from "./session-record.js";

export type SessionValidationResult =
	| { readonly status: "healthy"; readonly handshake: WorkspaceSessionHandshake }
	| { readonly status: "stale"; readonly reason: "process-missing" | "process-reused" }
	| {
			readonly status: "incompatible";
			readonly reason: "protocol-version" | "workspace-identity" | "session-identity";
	  }
	| { readonly status: "inaccessible"; readonly reason: "process-metadata" | "endpoint-permission" }
	| {
			readonly status: "indeterminate";
			readonly reason: "transport-failure" | "malformed-response" | "process-changed";
	  };

export async function validateRecordedSession(
	record: WorkspaceSessionRecord,
	workspaceId: string,
	processes: ProcessIdentityProvider,
	requestHandshake: () => Promise<WorkspaceSessionHandshake>,
): Promise<SessionValidationResult> {
	if (record.workspaceId !== workspaceId)
		return { status: "incompatible", reason: "workspace-identity" };
	let before: ProcessIdentity | undefined;
	try {
		before = await processes.inspect(record.pid);
	} catch (cause) {
		return {
			status: "inaccessible",
			reason:
				(cause as { code?: string }).code === "process.identity_inaccessible"
					? "process-metadata"
					: "process-metadata",
		};
	}
	if (!before) return { status: "stale", reason: "process-missing" };
	if (before.startedAt !== record.processStartedAt)
		return { status: "stale", reason: "process-reused" };
	let handshake: WorkspaceSessionHandshake;
	try {
		handshake = await requestHandshake();
	} catch (cause) {
		const code = (cause as { code?: string }).code;
		if (code === "EACCES" || code === "EPERM" || code === "permission.denied")
			return { status: "inaccessible", reason: "endpoint-permission" };
		const after = await processes.inspect(record.pid).catch(() => undefined);
		if (!after || after.startedAt !== before.startedAt)
			return { status: "indeterminate", reason: "process-changed" };
		return { status: "indeterminate", reason: "transport-failure" };
	}
	if (!handshake || typeof handshake !== "object" || typeof handshake.sessionId !== "string")
		return { status: "indeterminate", reason: "malformed-response" };
	if (handshake.protocolVersion !== WORKSPACE_PROTOCOL_VERSION)
		return { status: "incompatible", reason: "protocol-version" };
	if (handshake.workspaceId !== record.workspaceId)
		return { status: "incompatible", reason: "workspace-identity" };
	if (
		handshake.sessionId !== record.sessionId ||
		handshake.pid !== record.pid ||
		handshake.processStartedAt !== record.processStartedAt
	)
		return { status: "incompatible", reason: "session-identity" };
	return { status: "healthy", handshake };
}
