import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import type net from "node:net";
import process from "node:process";
import { createControlPlane, type WsrtControlPlane } from "@wsrt/control-plane";
import { resolveWorkspace } from "@wsrt/workspace";
import {
	DefaultWorkspaceIntelligence,
	type WorkspaceIntelligence,
} from "@wsrt/workspace-intelligence";
import { WorkspaceConfigurationTracker } from "./configuration-revision.js";
import { encodeFrame, LengthPrefixedFrameDecoder } from "./framing.js";
import { WorkspaceLeaseRegistry } from "./lease-registry.js";
import { PlatformProcessIdentityProvider, type ProcessIdentity } from "./process-identity.js";
import {
	protocolError,
	structuredError,
	validateRequestEnvelope,
	WORKSPACE_PROTOCOL_VERSION,
	type WorkspaceEventEnvelope,
	type WorkspaceResponseEnvelope,
	type WorkspaceSessionHandshake,
	type WorkspaceSessionState,
	workspacePermissions,
} from "./protocol.js";
import { WorkspaceRequestRouter } from "./request-router.js";
import { sessionPaths, writeSessionRecord } from "./session-record.js";
import { createWorkspaceTransportServer } from "./transport.js";
import { workspaceIdentity } from "./workspace-identity.js";
import { writeWorkspaceManifest } from "./workspace-manifest.js";

const geHostVersion = () => {
	const require = createRequire(import.meta.url);
	const { version } = require("../../wsrt/package.json");
	return version;
};

export class WorkspaceSessionHost {
	#state: WorkspaceSessionState = "starting";
	#plane?: WsrtControlPlane;
	#server?: net.Server;
	#unsubscribe?: () => void;
	#configuration?: WorkspaceConfigurationTracker;
	#intelligence?: WorkspaceIntelligence;
	readonly #sockets = new Set<net.Socket>();
	readonly #inflight = new Map<string, AbortController>();
	readonly #completedRequests = new Set<string>();
	readonly #leases = new WorkspaceLeaseRegistry();
	readonly #sessionId = crypto.randomUUID();
	readonly #createdAt = Date.now();
	readonly #processIdentity: ProcessIdentity;
	private constructor(
		readonly root: string,
		readonly workspaceId: string,
		processIdentity: ProcessIdentity,
		readonly config?: string,
	) {
		this.#processIdentity = processIdentity;
	}
	static async create(root: string, config?: string): Promise<WorkspaceSessionHost> {
		const identity = await workspaceIdentity(root);
		const processIdentity = await new PlatformProcessIdentityProvider().current();
		return new WorkspaceSessionHost(identity.root, identity.workspaceId, processIdentity, config);
	}
	async start(): Promise<void> {
		const paths = sessionPaths(this.root, this.workspaceId);
		await fs.mkdir(paths.directory, { recursive: true, mode: 0o700 });
		if (paths.endpoint.kind === "unix")
			await fs.unlink(paths.endpoint.address).catch((cause) => {
				if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
			});
		try {
			this.#plane = await createControlPlane({ root: this.root, config: this.config });
			const workspace = await resolveWorkspace({ root: this.root });
			this.#intelligence = new DefaultWorkspaceIntelligence({
				workspaceId: this.workspaceId,
				definition: this.#plane.definition(),
				graph: this.#plane.graph(),
				snapshot: () => {
					if (!this.#plane)
						throw protocolError("session.not_ready", "Workspace session is not ready");
					return this.#plane.snapshot();
				},
				workspace,
				contributions: this.#plane.pluginContributions("intelligence"),
				hostFeatures: {
					protocolVersion: WORKSPACE_PROTOCOL_VERSION,
					transports: [paths.endpoint.kind],
					subscriptions: true,
					commandExecution: true,
					changeImpact: true,
					commandPlanning: true,
					permissions: workspacePermissions,
				},
			});
			this.#configuration = await WorkspaceConfigurationTracker.create(
				this.#plane.definition().sourceFile,
				this.#plane.definition(),
			);
			const router = new WorkspaceRequestRouter(
				this.#plane,
				this.#intelligence,
				() => this.handshake(),
				async () => ({
					...this.handshake(),
					clients: this.#sockets.size,
					leases: this.#leases.list(),
					activeOperations:
						this.#plane
							?.listOperations()
							.filter((item) => item.status === "pending" || item.status === "running").length ?? 0,
					activeManagedNodes:
						this.#plane
							?.snapshot()
							.nodes.filter((item) =>
								["starting", "running", "ready", "stopping"].includes(item.state),
							).length ?? 0,
					configuration: await this.#configurationState(),
					endpointKind: paths.endpoint.kind,
					uptimeMs: Date.now() - this.#createdAt,
				}),
				() => setImmediate(() => void this.stop("requested")),
				this.#leases,
				async () => {
					const diagnostics = [...(this.#plane?.validate() ?? [])];
					const configuration = await this.#configurationState();
					if (configuration?.stale)
						diagnostics.push({
							code: "WSRT_SESSION_CONFIGURATION_STALE",
							severity: "warning",
							message: "Workspace configuration changed; restart the session to load it",
							source: {
								file: configuration.changedSources[0] ?? this.root,
								path: configuration.changedSources.join(","),
							},
						});
					return diagnostics;
				},
			);
			this.#server = createWorkspaceTransportServer(paths.endpoint, (socket) =>
				this.#accept(socket, router),
			);
			await new Promise<void>((resolve, reject) => {
				this.#server?.once("error", reject);
				this.#server?.listen(paths.endpoint.address, resolve);
			});
			this.#state = "ready";
			let previous = this.#plane.snapshot();
			let previousCapabilities = this.#intelligence.describeWorkspace().capabilities;
			this.#unsubscribe = this.#plane.subscribeSnapshots((snapshot) => {
				this.#broadcast({ type: "snapshot.updated", revision: snapshot.revision, snapshot });
				this.#broadcast({
					type: "workspace.revision.changed",
					previousRevision: previous.revision,
					revision: snapshot.revision,
				});
				for (const node of changedById(previous.nodes, snapshot.nodes))
					this.#broadcast({ type: "workspace.node.changed", revision: snapshot.revision, node });
				for (const operation of changedById(previous.operations, snapshot.operations))
					this.#broadcast({
						type: "workspace.operation.changed",
						revision: snapshot.revision,
						operation,
					});
				for (const diagnostic of added(previous.diagnostics, snapshot.diagnostics))
					this.#broadcast({
						type: "workspace.diagnostic.added",
						revision: snapshot.revision,
						diagnostic,
					});
				for (const artifact of changedById(previous.artifacts, snapshot.artifacts))
					this.#broadcast({
						type: "workspace.artifact.changed",
						revision: snapshot.revision,
						artifact,
					});
				const capabilities = this.#intelligence?.describeWorkspace().capabilities ?? [];
				if (JSON.stringify(capabilities) !== JSON.stringify(previousCapabilities))
					this.#broadcast({
						type: "workspace.capabilities.changed",
						revision: snapshot.revision,
						capabilities,
					});
				previous = snapshot;
				previousCapabilities = capabilities;
			});
			await writeSessionRecord(paths.record, {
				schemaVersion: 1,
				protocolVersion: WORKSPACE_PROTOCOL_VERSION,
				workspaceId: this.workspaceId,
				workspaceRoot: this.root,
				sessionId: this.#sessionId,
				pid: process.pid,
				processStartedAt: this.#processIdentity.startedAt,
				...(this.#processIdentity.executable
					? { processExecutable: this.#processIdentity.executable }
					: {}),
				endpoint: paths.endpoint,
				createdAt: new Date().toISOString(),
			});
			const semantic = this.#intelligence.describeWorkspace();
			await writeWorkspaceManifest(
				this.root,
				{ id: this.workspaceId, name: semantic.workspace.name },
				semantic.capabilities,
			);
		} catch (cause) {
			this.#state = "failed";
			await this.#cleanup();
			throw cause;
		}
	}
	async #configurationState() {
		if (!this.#configuration || !this.#plane) return undefined;
		const current = await this.#configuration.inspect(this.#plane.definition());
		return {
			loaded: this.#configuration.loaded,
			current: current.revision,
			stale: current.stale,
			changedSources: current.changedSources,
		};
	}
	handshake(): WorkspaceSessionHandshake {
		return {
			protocolVersion: WORKSPACE_PROTOCOL_VERSION,
			minimumClientProtocolVersion: WORKSPACE_PROTOCOL_VERSION,
			sessionId: this.#sessionId,
			workspaceId: this.workspaceId,
			workspaceRoot: this.root,
			pid: process.pid,
			processStartedAt: this.#processIdentity.startedAt,
			...(this.#processIdentity.executable
				? { processExecutable: this.#processIdentity.executable }
				: {}),
			hostVersion: geHostVersion(),
			state: this.#state,
		};
	}
	async stop(reason = "shutdown"): Promise<void> {
		if (this.#state === "stopping" || this.#state === "stopped") return;
		this.#state = "stopping";
		this.#leases.clear();
		const event: WorkspaceEventEnvelope = {
			protocolVersion: WORKSPACE_PROTOCOL_VERSION,
			sessionId: this.#sessionId,
			event: { type: "session.closing", reason },
		};
		for (const socket of this.#sockets) socket.write(encodeFrame(event));
		await this.#cleanup();
		this.#state = "stopped";
	}
	#accept(socket: net.Socket, router: WorkspaceRequestRouter) {
		this.#sockets.add(socket);
		const decoder = new LengthPrefixedFrameDecoder();
		socket.on("data", async (chunk) => {
			try {
				for (const frame of decoder.push(chunk)) {
					const envelope = validateRequestEnvelope(JSON.parse(frame.toString("utf8")));
					if (
						this.#inflight.has(envelope.requestId) ||
						this.#completedRequests.has(envelope.requestId)
					) {
						socket.write(
							encodeFrame({
								protocolVersion: WORKSPACE_PROTOCOL_VERSION,
								requestId: envelope.requestId,
								ok: false,
								error: {
									code: "request.duplicate_id",
									message: `Duplicate request ID ${envelope.requestId}`,
								},
							} satisfies WorkspaceResponseEnvelope),
						);
						continue;
					}
					let response: WorkspaceResponseEnvelope;
					try {
						if (envelope.request.type === "request.cancel") {
							const target = this.#inflight.get(envelope.request.targetRequestId);
							if (target)
								target.abort(
									protocolError(
										"request.cancelled",
										`Request ${envelope.request.targetRequestId} was cancelled`,
									),
								);
							response = {
								protocolVersion: WORKSPACE_PROTOCOL_VERSION,
								requestId: envelope.requestId,
								ok: true,
								result: {
									targetRequestId: envelope.request.targetRequestId,
									status: target
										? "cancelled"
										: this.#completedRequests.has(envelope.request.targetRequestId)
											? "completed"
											: "unknown",
								},
							};
						} else {
							if (this.#inflight.size >= 128)
								throw protocolError(
									"request.capacity_exceeded",
									"Too many concurrent workspace requests",
								);
							const controller = new AbortController();
							this.#inflight.set(envelope.requestId, controller);
							response = {
								protocolVersion: WORKSPACE_PROTOCOL_VERSION,
								requestId: envelope.requestId,
								ok: true,
								result: await router.route(envelope.request, controller.signal, envelope.requestId),
							};
						}
					} catch (cause) {
						response = {
							protocolVersion: WORKSPACE_PROTOCOL_VERSION,
							requestId: envelope.requestId,
							ok: false,
							error: structuredError(cause),
						};
					}
					this.#inflight.delete(envelope.requestId);
					this.#completedRequests.add(envelope.requestId);
					if (this.#completedRequests.size > 1_024)
						this.#completedRequests.delete(this.#completedRequests.values().next().value as string);
					if (!socket.destroyed) socket.write(encodeFrame(response));
				}
			} catch (cause) {
				socket.destroy(cause instanceof Error ? cause : undefined);
			}
		});
		socket.once("close", () => this.#sockets.delete(socket));
		socket.once("error", () => this.#sockets.delete(socket));
	}
	#broadcast(event: WorkspaceEventEnvelope["event"]) {
		const frame = encodeFrame({
			protocolVersion: WORKSPACE_PROTOCOL_VERSION,
			sessionId: this.#sessionId,
			event,
		} satisfies WorkspaceEventEnvelope);
		for (const socket of this.#sockets)
			if (!socket.destroyed && !socket.write(frame))
				socket.destroy(
					protocolError("transport.slow_client", "Workspace client exceeded its outbound buffer"),
				);
	}
	async #cleanup() {
		const paths = sessionPaths(this.root, this.workspaceId);
		for (const controller of this.#inflight.values())
			controller.abort(protocolError("host.shutting_down", "Workspace host is shutting down"));
		this.#inflight.clear();
		this.#unsubscribe?.();
		this.#unsubscribe = undefined;
		await this.#plane?.dispose();
		this.#plane = undefined;
		for (const socket of this.#sockets) socket.destroy();
		this.#sockets.clear();
		await new Promise<void>((resolve) => this.#server?.close(() => resolve()) ?? resolve());
		await fs.unlink(paths.record).catch(() => {});
		if (paths.endpoint.kind === "unix") await fs.unlink(paths.endpoint.address).catch(() => {});
	}
}

function changedById<T extends { id: string }>(previous: readonly T[], current: readonly T[]): T[] {
	const prior = new Map(previous.map((item) => [item.id, JSON.stringify(item)]));
	return current.filter((item) => prior.get(item.id) !== JSON.stringify(item));
}

function added<T>(previous: readonly T[], current: readonly T[]): T[] {
	const prior = new Set(previous.map((item) => JSON.stringify(item)));
	return current.filter((item) => !prior.has(JSON.stringify(item)));
}
