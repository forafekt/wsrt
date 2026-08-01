import type {
	ArtifactRecord,
	ControlPlaneCommand,
	ControlPlaneSnapshot,
	OperationSnapshot,
	SubmittedOperation,
	WorkspaceEvent,
} from "@wsrt/control-plane";
import type {
	DashboardActionDescriptor,
	WorkspaceClientLease,
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
		return this.request({ type: "command.submit", command });
	}
	execute(command: ControlPlaneCommand): Promise<unknown> {
		return this.request({ type: "command.execute", command });
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
