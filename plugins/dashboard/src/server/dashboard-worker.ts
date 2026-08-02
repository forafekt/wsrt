import { parentPort, workerData } from "node:worker_threads";
import type { DashboardBackend } from "../backend.js";
import type { DashboardSnapshot } from "../shared/contracts.js";
import { createDashboardServer } from "./dashboard-server.js";
import {
	createWorkerDashboardBackend,
	type DashboardBackendOutcome,
	type DashboardBackendRequest,
	DashboardTransportError,
	type DashboardWorkerTransport,
} from "./worker-backend.js";

const port = parentPort;

if (!port) throw new Error("Dashboard transport worker requires a parent port");

let snapshot: DashboardSnapshot = workerData.snapshot;

let sequence = 0;

const subscribers = new Set<(value: DashboardSnapshot) => void>();

const pending = new Map<
	number,
	{ resolve(value: DashboardBackendOutcome): void; reject(cause: DashboardTransportError): void }
>();

function sendRequest(request: DashboardBackendRequest): Promise<DashboardBackendOutcome> {
	return new Promise((resolve, reject) => {
		const id = ++sequence;
		pending.set(id, { resolve, reject });
		port.postMessage({ type: "backend-request", id, request });
	});
}

const transport: DashboardWorkerTransport = {
	snapshot: () => snapshot,
	subscribe(listener) {
		subscribers.add(listener);
		listener(snapshot);
		return () => subscribers.delete(listener);
	},
	request: sendRequest,
};

const backend: DashboardBackend = createWorkerDashboardBackend(transport);

const handle = await createDashboardServer(backend, workerData.options);

port.postMessage({
	type: "ready",
	handle: { url: handle.url, host: handle.host, port: handle.port, basePath: handle.basePath },
});

port.on("message", async (message: WorkerInboundMessage) => {
	if (message.type === "snapshot") {
		if (message.snapshot.revision <= snapshot.revision) return;
		snapshot = message.snapshot;
		for (const listener of subscribers) listener(snapshot);
	} else if (message.type === "backend-response") {
		const waiter = pending.get(message.id);
		if (!waiter) return;
		pending.delete(message.id);
		waiter.resolve(message.outcome);
	} else if (message.type === "control") {
		try {
			if (message.action === "disconnect") handle.disconnectClients();
			else await handle.close();
			port.postMessage({ type: "response", id: message.id });
		} catch (cause) {
			port.postMessage({
				type: "response",
				id: message.id,
				error: cause instanceof Error ? cause.message : String(cause),
			});
		}
	}
});

port.once("close", () => {
	const error = new DashboardTransportError("Dashboard parent transport closed");
	for (const waiter of pending.values()) waiter.reject(error);
	pending.clear();
	subscribers.clear();
});

type WorkerInboundMessage =
	| { type: "snapshot"; snapshot: DashboardSnapshot }
	| { type: "backend-response"; id: number; outcome: DashboardBackendOutcome }
	| { type: "control"; id: number; action: "disconnect" | "close" };
