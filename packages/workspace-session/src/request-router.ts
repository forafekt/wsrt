import { controlPlaneCommandPermission, type WsrtControlPlane } from "@wsrt/control-plane";
import type {
	WorkspaceIntelligence,
	WorkspaceIntelligenceSnapshot,
} from "@wsrt/workspace-intelligence";
import { DashboardActionRouter } from "./dashboard-actions.js";
import type { WorkspaceLeaseRegistry } from "./lease-registry.js";
import {
	protocolError,
	WORKSPACE_PROTOCOL_VERSION,
	type WorkspacePermission,
	type WorkspaceRequest,
} from "./protocol.js";

export class WorkspaceRequestRouter {
	constructor(
		readonly plane: WsrtControlPlane,
		readonly intelligence: WorkspaceIntelligence,
		readonly handshake: () => unknown,
		readonly status: () => unknown,
		readonly stop: () => void,
		readonly leases: WorkspaceLeaseRegistry,
		readonly diagnostics: () => unknown | Promise<unknown>,
		readonly dashboardActions = new DashboardActionRouter(plane),
	) {}
	async route(
		request: WorkspaceRequest,
		signal = new AbortController().signal,
		requestId = "internal",
	): Promise<unknown> {
		switch (request.type) {
			case "session.handshake":
				return this.handshake();
			case "session.status":
				return this.status();
			case "session.stop":
				this.stop();
				return { stopping: true };
			case "workspace.capabilities": {
				const snapshot = this.#workspaceSnapshot(request.expectedRevision);
				return this.#workspaceResponse(snapshot, snapshot.capabilities, requestId);
			}
			case "workspace.describe": {
				const snapshot = this.#workspaceSnapshot(request.expectedRevision);
				return this.#workspaceResponse(snapshot, snapshot, requestId);
			}
			case "workspace.get-started": {
				const snapshot = this.#workspaceSnapshot(request.expectedRevision);
				return this.#workspaceResponse(snapshot, this.intelligence.getStarted(), requestId);
			}
			case "workspace.node.describe":
			case "workspace.task.describe":
			case "workspace.artifact.describe": {
				const snapshot = this.#workspaceSnapshot(request.expectedRevision);
				return this.#workspaceResponse(
					snapshot,
					this.intelligence.describeNode(
						request.nodeId,
						"options" in request ? request.options : undefined,
					),
					requestId,
				);
			}
			case "workspace.graph.query": {
				const snapshot = this.#workspaceSnapshot(request.expectedRevision);
				return this.#workspaceResponse(
					snapshot,
					this.intelligence.queryGraph(request.query),
					requestId,
				);
			}
			case "workspace.nodes.query": {
				const snapshot = this.#workspaceSnapshot(request.expectedRevision);
				return this.#workspaceResponse(
					snapshot,
					this.intelligence.queryNodes(request.query),
					requestId,
				);
			}
			case "workspace.files.query": {
				const snapshot = this.#workspaceSnapshot(request.expectedRevision);
				return this.#workspaceResponse(
					snapshot,
					this.intelligence.queryFiles(request.query),
					requestId,
				);
			}
			case "workspace.file.owners": {
				const snapshot = this.#workspaceSnapshot(request.expectedRevision);
				return this.#workspaceResponse(
					snapshot,
					this.intelligence.queryFiles({ paths: [request.path], includeGenerated: true }),
					requestId,
				);
			}
			case "workspace.change.impact": {
				const snapshot = this.#workspaceSnapshot(request.expectedRevision);
				return this.#workspaceResponse(
					snapshot,
					this.intelligence.analyzeChangeImpact(request.query),
					requestId,
				);
			}
			case "workspace.validation.recommend": {
				const snapshot = this.#workspaceSnapshot(request.expectedRevision);
				return this.#workspaceResponse(
					snapshot,
					this.intelligence.recommendValidation(request.query),
					requestId,
				);
			}
			case "workspace.command.plan": {
				this.#authorize(request.command, request.permissions, true);
				const snapshot = this.#workspaceSnapshot(request.expectedRevision);
				return this.#workspaceResponse(
					snapshot,
					this.intelligence.planCommand(request.command),
					requestId,
				);
			}
			case "workspace.command.execute": {
				this.#authorize(request.command, request.permissions, false);
				const snapshot = this.#workspaceSnapshot(request.expectedRevision);
				const result =
					request.command.type === "operation.cancel"
						? await this.plane.execute(request.command)
						: await this.plane.execute(request.command);
				return this.#workspaceResponse(snapshot, result, requestId);
			}
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
				this.#authorize(request.command, request.permissions, false);
				if (request.command.type === "operation.cancel")
					throw protocolError(
						"command.rejected",
						"Cancellation cannot be submitted asynchronously",
					);
				return this.plane.submit(request.command);
			}
			case "command.execute": {
				this.#authorize(request.command, request.permissions, false);
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

	#authorize(
		command: Parameters<WorkspaceIntelligence["planCommand"]>[0],
		permissions: readonly WorkspacePermission[] | undefined,
		planning: boolean,
	) {
		const required = planning ? "commands.plan" : controlPlaneCommandPermission(command);
		if (!permissions?.includes(required))
			throw protocolError("authorization.denied", `Permission ${required} is required`, {
				requiredPermission: required,
			});
	}

	#workspaceSnapshot(expectedRevision?: number): WorkspaceIntelligenceSnapshot {
		const snapshot = this.intelligence.describeWorkspace();
		if (expectedRevision !== undefined && expectedRevision !== snapshot.workspaceRevision)
			throw protocolError(
				"workspace.revision_stale",
				`Expected workspace revision ${expectedRevision}, current revision is ${snapshot.workspaceRevision}`,
				{ expectedRevision, currentRevision: snapshot.workspaceRevision },
			);
		return snapshot;
	}

	#workspaceResponse<T>(snapshot: WorkspaceIntelligenceSnapshot, result: T, requestId: string) {
		return {
			metadata: {
				protocolVersion: WORKSPACE_PROTOCOL_VERSION,
				workspaceRevision: snapshot.workspaceRevision,
				generatedAt: snapshot.generatedAt,
				requestId,
			},
			result,
		};
	}
}
