import type {
	ArtifactRecord,
	ControlPlaneCommand,
	ControlPlaneSnapshot,
	OperationSnapshot,
	SubmittedOperation,
	WorkspaceEvent,
} from "@wsrt/control-plane";
import { controlPlaneCommandPermission } from "@wsrt/control-plane";
import type { ChangeImpactQuery, FileQuery, GraphQuery } from "@wsrt/workspace-intelligence";
import type {
	DashboardActionDescriptor,
	WorkspaceCapabilitiesResponse,
	WorkspaceChangeImpactResponse,
	WorkspaceClientLease,
	WorkspaceCommandExecuteResponse,
	WorkspaceCommandPlanResponse,
	WorkspaceDescribeResponse,
	WorkspaceFilesQueryResponse,
	WorkspaceGraphQueryResponse,
	WorkspaceNodeDescribeResponse,
	WorkspacePermission,
	WorkspaceSessionHandshake,
} from "./protocol.js";
import type { WorkspaceTransportConnection } from "./transport.js";

export class WorkspaceSessionClient {
	constructor(
		readonly connection: WorkspaceTransportConnection,
		readonly session: WorkspaceSessionHandshake,
	) {}
	request<T = unknown>(
		request: Parameters<WorkspaceTransportConnection["request"]>[0],
		options?: Parameters<WorkspaceTransportConnection["request"]>[1],
	): Promise<T> {
		return this.connection.request(request, options) as Promise<T>;
	}
	handshake(): WorkspaceSessionHandshake {
		return this.session;
	}
	getCapabilities(
		options: WorkspaceIntelligenceRequestOptions = {},
	): Promise<WorkspaceCapabilitiesResponse> {
		return this.request(
			{ type: "workspace.capabilities", ...revisionOption(options.expectedRevision) },
			{ signal: options.signal },
		);
	}
	describeWorkspace(
		options: WorkspaceIntelligenceRequestOptions = {},
	): Promise<WorkspaceDescribeResponse> {
		return this.request(
			{ type: "workspace.describe", ...revisionOption(options.expectedRevision) },
			{ signal: options.signal },
		);
	}
	describeNode(
		nodeId: string,
		options: WorkspaceIntelligenceRequestOptions = {},
	): Promise<WorkspaceNodeDescribeResponse> {
		return this.request(
			{ type: "workspace.node.describe", nodeId, ...revisionOption(options.expectedRevision) },
			{ signal: options.signal },
		);
	}
	queryGraph(
		query: GraphQuery,
		options: WorkspaceIntelligenceRequestOptions = {},
	): Promise<WorkspaceGraphQueryResponse> {
		return this.request(
			{ type: "workspace.graph.query", query, ...revisionOption(options.expectedRevision) },
			{ signal: options.signal },
		);
	}
	queryFiles(
		query: FileQuery,
		options: WorkspaceIntelligenceRequestOptions = {},
	): Promise<WorkspaceFilesQueryResponse> {
		return this.request(
			{ type: "workspace.files.query", query, ...revisionOption(options.expectedRevision) },
			{ signal: options.signal },
		);
	}
	analyzeChangeImpact(
		query: ChangeImpactQuery,
		options: WorkspaceIntelligenceRequestOptions = {},
	): Promise<WorkspaceChangeImpactResponse> {
		return this.request(
			{ type: "workspace.change.impact", query, ...revisionOption(options.expectedRevision) },
			{ signal: options.signal },
		);
	}
	planCommand(
		command: ControlPlaneCommand,
		options: WorkspaceIntelligenceRequestOptions = {},
	): Promise<WorkspaceCommandPlanResponse> {
		return this.request(
			{
				type: "workspace.command.plan",
				command,
				permissions: options.permissions ?? ["commands.plan"],
				...revisionOption(options.expectedRevision),
			},
			{ signal: options.signal },
		);
	}
	executeWorkspaceCommand(
		command: ControlPlaneCommand,
		options: WorkspaceCommandExecutionOptions,
	): Promise<WorkspaceCommandExecuteResponse> {
		return this.request(
			{
				type: "workspace.command.execute",
				command,
				permissions: options.permissions,
				...revisionOption(options.expectedRevision),
			},
			{ signal: options.signal },
		);
	}
	snapshot(): Promise<ControlPlaneSnapshot> {
		return this.request({ type: "snapshot.get" });
	}
	definition(): Promise<unknown> {
		return this.request({ type: "definition.get" });
	}
	operations(): Promise<readonly OperationSnapshot[]> {
		return this.request({ type: "operations.get" });
	}
	events(): Promise<readonly WorkspaceEvent[]> {
		return this.request({ type: "events.get" });
	}
	artifacts(): Promise<readonly ArtifactRecord[]> {
		return this.request({ type: "artifacts.get" });
	}
	diagnostics(): Promise<unknown> {
		return this.request({ type: "diagnostics.get" });
	}
	graph(): Promise<unknown> {
		return this.request({ type: "graph.get" });
	}
	plugins(): Promise<unknown> {
		return this.request({ type: "plugins.get" });
	}
	complete(input: string): Promise<readonly string[]> {
		return this.request({ type: "completion.get", input });
	}
	submit(command: ControlPlaneCommand): Promise<SubmittedOperation> {
		return this.request({
			type: "command.submit",
			command,
			permissions: [controlPlaneCommandPermission(command)],
		});
	}
	execute(command: ControlPlaneCommand): Promise<unknown> {
		return this.request({
			type: "command.execute",
			command,
			permissions: [controlPlaneCommandPermission(command)],
		});
	}
	status(): Promise<unknown> {
		return this.request({ type: "session.status" });
	}
	async stopSession(): Promise<unknown> {
		const result = await this.request({ type: "session.stop" });
		await Promise.race([
			this.connection.closed,
			new Promise((resolve) => {
				const timer = setTimeout(resolve, 15_000);
				timer.unref?.();
			}),
		]);
		return result;
	}
	acquireLease(kind: WorkspaceClientLease["kind"]): Promise<WorkspaceClientLease> {
		return this.request({ type: "lease.acquire", kind });
	}
	renewLease(leaseId: string): Promise<WorkspaceClientLease> {
		return this.request({ type: "lease.renew", leaseId });
	}
	releaseLease(leaseId: string): Promise<{ released: boolean }> {
		return this.request({ type: "lease.release", leaseId });
	}
	dashboardActions(): Promise<readonly DashboardActionDescriptor[]> {
		return this.request({ type: "dashboard.action.list" });
	}
	invokeDashboardAction(actionId: string, input?: unknown, signal?: AbortSignal): Promise<unknown> {
		return this.request({ type: "dashboard.action.invoke", actionId, input }, { signal });
	}
	startSubscription(afterRevision?: number): Promise<unknown> {
		return this.request({ type: "subscription.start", afterRevision });
	}
	subscribe(listener: Parameters<WorkspaceTransportConnection["subscribe"]>[0]): () => void {
		return this.connection.subscribe(listener);
	}
	close(): Promise<void> {
		return this.connection.close();
	}
}

export type WorkspaceIntelligenceRequestOptions = Readonly<{
	expectedRevision?: number;
	signal?: AbortSignal;
	permissions?: readonly WorkspacePermission[];
}>;

export type WorkspaceCommandExecutionOptions = Readonly<{
	permissions: readonly WorkspacePermission[];
	expectedRevision?: number;
	signal?: AbortSignal;
}>;

function revisionOption(expectedRevision?: number): { expectedRevision?: number } {
	return expectedRevision === undefined ? {} : { expectedRevision };
}
