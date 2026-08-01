import crypto from "node:crypto";
import fs from "node:fs/promises";
import type net from "node:net";
import process from "node:process";
import { createControlPlane, type WsrtControlPlane } from "@wsrt/control-plane";
import { encodeFrame, LengthPrefixedFrameDecoder } from "./framing.js";
import {
	structuredError,
	validateRequestEnvelope,
	WORKSPACE_PROTOCOL_VERSION,
	type WorkspaceEventEnvelope,
	type WorkspaceResponseEnvelope,
	type WorkspaceSessionHandshake,
	type WorkspaceSessionState,
} from "./protocol.js";
import { WorkspaceRequestRouter } from "./request-router.js";
import { sessionPaths, writeSessionRecord } from "./session-record.js";
import { createWorkspaceTransportServer } from "./transport.js";
import { workspaceIdentity } from "./workspace-identity.js";

export class WorkspaceSessionHost {
	#state: WorkspaceSessionState = "starting";
	#plane?: WsrtControlPlane;
	#server?: net.Server;
	#unsubscribe?: () => void;
	readonly #sockets = new Set<net.Socket>();
	readonly #sessionId = crypto.randomUUID();
	readonly #startedAt = new Date().toISOString();
	private constructor(
		readonly root: string,
		readonly workspaceId: string,
		readonly config?: string,
	) {}
	static async create(root: string, config?: string): Promise<WorkspaceSessionHost> {
		const identity = await workspaceIdentity(root);
		return new WorkspaceSessionHost(identity.root, identity.workspaceId, config);
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
			const router = new WorkspaceRequestRouter(
				this.#plane,
				() => this.handshake(),
				() => ({ ...this.handshake(), clients: this.#sockets.size }),
				() => setImmediate(() => void this.stop("requested")),
			);
			this.#server = createWorkspaceTransportServer(paths.endpoint, (socket) =>
				this.#accept(socket, router),
			);
			await new Promise<void>((resolve, reject) => {
				this.#server?.once("error", reject);
				this.#server?.listen(paths.endpoint.address, resolve);
			});
			this.#state = "ready";
			this.#unsubscribe = this.#plane.subscribeSnapshots((snapshot) => {
				const event: WorkspaceEventEnvelope = {
					protocolVersion: WORKSPACE_PROTOCOL_VERSION,
					event: { type: "snapshot.updated", revision: snapshot.revision, snapshot },
				};
				const frame = encodeFrame(event);
				for (const socket of this.#sockets) if (!socket.destroyed) socket.write(frame);
			});
			await writeSessionRecord(paths.record, {
				schemaVersion: 1,
				protocolVersion: WORKSPACE_PROTOCOL_VERSION,
				workspaceId: this.workspaceId,
				workspaceRoot: this.root,
				sessionId: this.#sessionId,
				pid: process.pid,
				processStartedAt: this.#startedAt,
				endpoint: paths.endpoint,
				createdAt: new Date().toISOString(),
			});
		} catch (cause) {
			this.#state = "failed";
			await this.#cleanup();
			throw cause;
		}
	}
	handshake(): WorkspaceSessionHandshake {
		return {
			protocolVersion: WORKSPACE_PROTOCOL_VERSION,
			minimumClientProtocolVersion: WORKSPACE_PROTOCOL_VERSION,
			sessionId: this.#sessionId,
			workspaceId: this.workspaceId,
			workspaceRoot: this.root,
			pid: process.pid,
			processStartedAt: this.#startedAt,
			hostVersion: "0.1.0-alpha.0",
			state: this.#state,
		};
	}
	async stop(reason = "shutdown"): Promise<void> {
		if (this.#state === "stopping" || this.#state === "stopped") return;
		this.#state = "stopping";
		const event: WorkspaceEventEnvelope = {
			protocolVersion: WORKSPACE_PROTOCOL_VERSION,
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
					let response: WorkspaceResponseEnvelope;
					try {
						response = {
							protocolVersion: WORKSPACE_PROTOCOL_VERSION,
							requestId: envelope.requestId,
							ok: true,
							result: await router.route(envelope.request),
						};
					} catch (cause) {
						response = {
							protocolVersion: WORKSPACE_PROTOCOL_VERSION,
							requestId: envelope.requestId,
							ok: false,
							error: structuredError(cause),
						};
					}
					if (!socket.destroyed) socket.write(encodeFrame(response));
				}
			} catch (cause) {
				socket.destroy(cause instanceof Error ? cause : undefined);
			}
		});
		socket.once("close", () => this.#sockets.delete(socket));
		socket.once("error", () => this.#sockets.delete(socket));
	}
	async #cleanup() {
		const paths = sessionPaths(this.root, this.workspaceId);
		await new Promise<void>((resolve) => this.#server?.close(() => resolve()) ?? resolve());
		for (const socket of this.#sockets) socket.destroy();
		this.#sockets.clear();
		this.#unsubscribe?.();
		this.#unsubscribe = undefined;
		await this.#plane?.dispose();
		this.#plane = undefined;
		await fs.unlink(paths.record).catch(() => {});
		if (paths.endpoint.kind === "unix") await fs.unlink(paths.endpoint.address).catch(() => {});
	}
}
