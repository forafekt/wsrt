import { Worker } from "node:worker_threads";
import { serializeControlPlaneError, type WsrtControlPlane } from "@wsrt/control-plane";
import { createDirectDashboardBackend } from "../backend.js";
import { type DashboardOptions, normalizeDashboardOptions } from "../plugin/index.js";
import type { DashboardHandle } from "./dashboard-server.js";
import {
	type DashboardBackendOutcome,
	type DashboardBackendRequest,
	DashboardTransportError,
	executeDashboardBackendRequest,
} from "./worker-backend.js";

export async function startDashboard(
	controlPlane: WsrtControlPlane,
	input: DashboardOptions = {},
): Promise<DashboardHandle> {
	const backend = await createDirectDashboardBackend(controlPlane);
	const worker = new Worker(new URL("./dashboard-worker.js", import.meta.url), {
		workerData: { options: normalizeDashboardOptions(input), snapshot: backend.snapshot() },
	});
	const ready = new Promise<Omit<DashboardHandle, "disconnectClients" | "close">>(
		(resolve, reject) => {
			worker.on("message", async (message: WorkerHostMessage) => {
				if (message.type === "ready") resolve(message.handle);
				if (message.type === "backend-request") {
					try {
						const response = await executeDashboardBackendRequest(backend, message.request);
						worker.postMessage({
							type: "backend-response",
							id: message.id,
							outcome: { type: "success", response } satisfies DashboardBackendOutcome,
						});
					} catch (cause) {
						worker.postMessage({
							type: "backend-response",
							id: message.id,
							outcome: {
								type: "domain-error",
								error: serializeControlPlaneError(cause),
							} satisfies DashboardBackendOutcome,
						});
					}
				}
			});
			worker.once("error", (cause) =>
				reject(new DashboardTransportError(cause.message, { cause })),
			);
			worker.once("exit", (code) => {
				if (code !== 0)
					reject(new DashboardTransportError(`Dashboard worker exited with code ${code}`));
			});
		},
	);
	const unsubscribe = backend.subscribe((snapshot) =>
		worker.postMessage({ type: "snapshot", snapshot }),
	);
	let handle: Omit<DashboardHandle, "disconnectClients" | "close">;
	try {
		handle = await ready;
	} catch (cause) {
		unsubscribe();
		await worker.terminate();
		throw cause;
	}
	let sequence = 0;
	const pending = new Map<number, { resolve(): void; reject(cause: unknown): void }>();
	const rejectPending = (cause: DashboardTransportError) => {
		for (const waiter of pending.values()) waiter.reject(cause);
		pending.clear();
	};
	worker.once("error", (cause) =>
		rejectPending(new DashboardTransportError(cause.message, { cause })),
	);
	worker.once("exit", (code) => {
		if (code !== 0)
			rejectPending(new DashboardTransportError(`Dashboard worker exited with code ${code}`));
	});
	worker.on("message", (message: WorkerHostMessage) => {
		if (message.type !== "response") return;
		const waiter = pending.get(message.id);
		if (!waiter) return;
		pending.delete(message.id);
		if (message.error) waiter.reject(new DashboardTransportError(message.error));
		else waiter.resolve();
	});
	const control = (action: "disconnect" | "close") =>
		new Promise<void>((resolve, reject) => {
			const id = ++sequence;
			pending.set(id, { resolve, reject });
			worker.postMessage({ type: "control", id, action });
		});
	let closed = false;
	return {
		...handle,
		disconnectClients: () => void control("disconnect"),
		async close() {
			if (closed) return;
			closed = true;
			unsubscribe();
			await control("close");
			await worker.terminate();
		},
	};
}

type WorkerHostMessage =
	| { type: "ready"; handle: Omit<DashboardHandle, "disconnectClients" | "close"> }
	| { type: "backend-request"; id: number; request: DashboardBackendRequest }
	| { type: "response"; id: number; error?: string };
