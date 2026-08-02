import type { WsrtControlPlane } from "@wsrt/control-plane";
import { DashboardActionRouter } from "./dashboard-actions.js";
import type { WorkspaceLeaseRegistry } from "./lease-registry.js";
import { protocolError, type WorkspaceRequest } from "./protocol.js";

export class WorkspaceRequestRouter {
	constructor(
		readonly plane: WsrtControlPlane,
		readonly handshake: () => unknown,
		readonly status: () => unknown,
		readonly stop: () => void,
		readonly leases: WorkspaceLeaseRegistry,
		readonly diagnostics: () => unknown | Promise<unknown>,
		readonly dashboardActions = new DashboardActionRouter(plane),
	) {}
	async route(request: WorkspaceRequest, signal = new AbortController().signal): Promise<unknown> {
		switch (request.type) {
			case "session.handshake":
				return this.handshake();
			case "session.status":
				return this.status();
			case "session.stop":
				this.stop();
				return { stopping: true };
			case "request.cancel":
				throw protocolError(
					"request.invalid_cancel_route",
					"Cancellation is handled by the host request registry",
				);
			case "lease.acquire":
				return this.leases.acquire(request.kind);
			case "lease.renew": {
				const lease = this.leases.renew(request.leaseId);
				if (!lease)
					throw protocolError("lease.not_found", `Lease ${request.leaseId} is not active`);
				return lease;
			}
			case "lease.release":
				return { released: this.leases.release(request.leaseId) };
			case "dashboard.action.list":
				return this.dashboardActions.list();
			case "dashboard.action.invoke":
				return this.dashboardActions.invoke(request.actionId, request.input, signal);
			case "subscription.start": {
				const snapshot = this.plane.snapshot();
				return request.afterRevision === snapshot.revision
					? { mode: "resumed", revision: snapshot.revision }
					: { mode: "snapshot-required", revision: snapshot.revision, snapshot };
			}
			case "snapshot.get":
				return this.plane.snapshot();
			case "definition.get":
				return this.plane.definition();
			case "operations.get":
				return this.plane.listOperations();
			case "events.get":
				return this.plane.listEvents();
			case "artifacts.get":
				return this.plane.listArtifacts();
			case "diagnostics.get":
				return this.diagnostics();
			case "graph.get":
				return this.plane.graph().toJSON();
			case "plugins.get":
				return this.plane.snapshot().plugins;
			case "completion.get":
				return this.plane.complete(request.input);
			case "command.submit": {
				if (request.command.type === "operation.cancel")
					throw protocolError(
						"command.rejected",
						"Cancellation cannot be submitted asynchronously",
					);
				return this.plane.submit(request.command);
			}
			case "command.execute": {
				if (request.command.type === "operation.cancel") return this.plane.execute(request.command);
				return this.plane.execute(request.command);
			}
			default:
				throw protocolError(
					"request.unsupported",
					`Unsupported workspace request: ${(request as { type: string }).type}`,
				);
		}
	}
}
