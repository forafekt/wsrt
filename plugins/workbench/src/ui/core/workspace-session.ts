import type { ArtifactRecord, ControlPlaneSnapshot, OperationSnapshot } from "@wsrt/control-plane";
import type {
	WorkspaceDescribeResponse,
	WorkspaceGetStartedResponse,
	WorkspaceRequest,
	WorkspaceSessionEvent,
	WorkspaceSessionHandshake,
} from "@wsrt/workspace-session";

export type BootstrapPayload = Readonly<{
	description: WorkspaceDescribeResponse;
	started: WorkspaceGetStartedResponse;
	snapshot: ControlPlaneSnapshot;
	operations: readonly OperationSnapshot[];
	diagnostics: unknown;
	artifacts: readonly ArtifactRecord[];
	status: unknown;
	handshake: WorkspaceSessionHandshake;
}>;

export type WorkspaceResponse<T = unknown> = Readonly<{
	metadata?: Readonly<Record<string, unknown>>;
	result?: T;
}>;

export type WorkspaceRequestInput = WorkspaceRequest;

export type WorkspaceEventMessage =
	| WorkspaceSessionEvent
	| Readonly<{ type: string; revision?: number; [key: string]: unknown }>;
