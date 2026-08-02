import crypto from "node:crypto";
import net from "node:net";
import { encodeFrame, LengthPrefixedFrameDecoder } from "./framing.js";
import {
	protocolError,
	WORKSPACE_PROTOCOL_VERSION,
	type WorkspaceEventEnvelope,
	type WorkspaceRequest,
	type WorkspaceRequestEnvelope,
	type WorkspaceResponseEnvelope,
} from "./protocol.js";
import type { WorkspaceEndpoint } from "./session-record.js";

export class WorkspaceTransportConnection {
	readonly closed: Promise<void>;
	#resolveClosed!: () => void;
	readonly #pending = new Map<
		string,
		{
			resolve(value: unknown): void;
			reject(cause: unknown): void;
			timer: NodeJS.Timeout;
			cleanup(): void;
		}
	>();
	readonly #listeners = new Set<(event: WorkspaceEventEnvelope["event"]) => void>();
	readonly #decoder = new LengthPrefixedFrameDecoder();
	#closed = false;
	private constructor(readonly socket: net.Socket) {
		this.closed = new Promise((resolve) => {
			this.#resolveClosed = resolve;
		});
		socket.on("data", (chunk) => this.#receive(chunk));
		socket.once("error", (cause) => this.#fail(cause));
		socket.once("close", () => {
			this.#resolveClosed();
			this.#fail(protocolError("transport.unavailable", "Workspace connection closed"));
		});
	}
	static connect(
		endpoint: WorkspaceEndpoint,
		timeoutMs = 2_000,
	): Promise<WorkspaceTransportConnection> {
		return new Promise((resolve, reject) => {
			const socket = net.createConnection(endpoint.address);
			const timer = setTimeout(() => {
				socket.destroy();
				reject(
					protocolError(
						"transport.unavailable",
						`Timed out connecting to ${endpoint.kind} endpoint`,
					),
				);
			}, timeoutMs);
			socket.once("connect", () => {
				clearTimeout(timer);
				resolve(new WorkspaceTransportConnection(socket));
			});
			socket.once("error", (cause) => {
				clearTimeout(timer);
				reject(
					Object.assign(new Error(`Workspace transport unavailable: ${cause.message}`), {
						code: "transport.unavailable",
						cause,
					}),
				);
			});
		});
	}
	request(
		request: WorkspaceRequest,
		options: { timeoutMs?: number; signal?: AbortSignal } = {},
	): Promise<unknown> {
		if (this.#closed)
			return Promise.reject(
				protocolError("transport.unavailable", "Workspace connection is closed"),
			);
		const requestId = crypto.randomUUID();
		const timeoutMs = options.timeoutMs ?? 15_000;
		const envelope: WorkspaceRequestEnvelope = {
			protocolVersion: WORKSPACE_PROTOCOL_VERSION,
			requestId,
			request,
		};
		return new Promise((resolve, reject) => {
			const abort = () => {
				this.#pending.delete(requestId);
				clearTimeout(timer);
				options.signal?.removeEventListener("abort", abort);
				void this.request({ type: "request.cancel", targetRequestId }, { timeoutMs: 2_000 }).catch(
					() => {},
				);
				reject(
					options.signal?.reason ??
						protocolError("request.cancelled", `Workspace request ${requestId} was cancelled`),
				);
			};
			const targetRequestId = requestId;
			const timer = setTimeout(() => {
				this.#pending.delete(requestId);
				options.signal?.removeEventListener("abort", abort);
				void this.request({ type: "request.cancel", targetRequestId }, { timeoutMs: 2_000 }).catch(
					() => {},
				);
				reject(
					protocolError("request.timeout", `Workspace request ${requestId} timed out`, {
						requestId,
					}),
				);
			}, timeoutMs);
			const cleanup = () => options.signal?.removeEventListener("abort", abort);
			this.#pending.set(requestId, { resolve, reject, timer, cleanup });
			if (options.signal?.aborted) {
				abort();
				return;
			}
			options.signal?.addEventListener("abort", abort, { once: true });
			this.socket.write(encodeFrame(envelope), (cause) => {
				if (cause) this.#settleError(requestId, cause);
			});
		});
	}
	subscribe(listener: (event: WorkspaceEventEnvelope["event"]) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}
	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		await new Promise<void>((resolve) => this.socket.end(resolve));
		this.#fail(protocolError("transport.unavailable", "Workspace connection closed"));
	}
	#receive(chunk: Buffer) {
		try {
			for (const frame of this.#decoder.push(chunk)) {
				const value = JSON.parse(frame.toString("utf8")) as
					| WorkspaceResponseEnvelope
					| WorkspaceEventEnvelope;
				if ("event" in value) {
					for (const listener of this.#listeners) listener(value.event);
					continue;
				}
				const pending = this.#pending.get(value.requestId);
				if (!pending) continue;
				this.#pending.delete(value.requestId);
				clearTimeout(pending.timer);
				pending.cleanup();
				if (value.ok) pending.resolve(value.result);
				else if ("error" in value)
					pending.reject(Object.assign(new Error(value.error.message), value.error));
			}
		} catch (cause) {
			this.socket.destroy();
			this.#fail(cause);
		}
	}
	#settleError(id: string, cause: unknown) {
		const pending = this.#pending.get(id);
		if (!pending) return;
		this.#pending.delete(id);
		clearTimeout(pending.timer);
		pending.cleanup();
		pending.reject(cause);
	}
	#fail(cause: unknown) {
		for (const id of this.#pending.keys()) this.#settleError(id, cause);
	}
}

export function createWorkspaceTransportServer(
	endpoint: WorkspaceEndpoint,
	onSocket: (socket: net.Socket) => void,
): net.Server {
	void endpoint;
	return net.createServer(onSocket);
}
