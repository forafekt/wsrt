import { parentPort, workerData } from "node:worker_threads";
import type { WsrtControlPlane } from "@wsrt/control-plane";
import type { DashboardOptions } from "../plugin/index.js";
import { startDashboardInProcess } from "./dashboard-server.js";

type WireSnapshot = {
	controlPlane: ReturnType<WsrtControlPlane["snapshot"]>;
	graph: { nodes: Array<{ id: string }>; edges: unknown[] };
	events: ReturnType<WsrtControlPlane["listEvents"]>;
	configuration: ReturnType<WsrtControlPlane["definition"]>;
	contributions: Array<{ id: string; kind: string; [key: string]: unknown }>;
};

const port = parentPort;
if (!port) throw new Error("Dashboard transport worker requires a parent port");
let snapshot = workerData.snapshot as WireSnapshot;
let sequence = 0;
const subscribers = new Set<(value: WireSnapshot["controlPlane"]) => void>();
const pending = new Map<number, { resolve(value: unknown): void; reject(cause: unknown): void }>();

function sendCommand(command: unknown): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const id = ++sequence;
		pending.set(id, { resolve, reject });
		port.postMessage({ type: "command", id, command });
	});
}

const plane = {
	snapshot: () => snapshot.controlPlane,
	definition: () => snapshot.configuration,
	graph: () => ({ toJSON: () => snapshot.graph }),
	listEvents: () => snapshot.events,
	listArtifacts: () => snapshot.controlPlane.artifacts,
	listOperations: () => snapshot.controlPlane.operations,
	getOperation: (id: string) => snapshot.controlPlane.operations.find((item) => item.id === id),
	getNode: (id: string) => snapshot.graph.nodes.find((item) => item.id === id),
	getDependencies: (id: string) =>
		snapshot.graph.edges
			.filter((edge: any) => edge.from === id)
			.map((edge: any) => snapshot.graph.nodes.find((node) => node.id === edge.to))
			.filter(Boolean),
	getConsumers: (id: string) =>
		snapshot.graph.edges
			.filter((edge: any) => edge.to === id)
			.map((edge: any) => snapshot.graph.nodes.find((node) => node.id === edge.from))
			.filter(Boolean),
	pluginContributions: () =>
		snapshot.contributions.map((contribution) => ({
			...contribution,
			...(["action", "command", "artifact-action", "operation-action"].includes(contribution.kind)
				? {
						run: () =>
							sendCommand({
								type: "contribution",
								contributionId: contribution.id,
							}),
					}
				: {}),
		})),
	subscribeSnapshots(listener: (value: WireSnapshot["controlPlane"]) => void) {
		subscribers.add(listener);
		listener(snapshot.controlPlane);
		return () => subscribers.delete(listener);
	},
	submit(type: string, nodeIds: string[]) {
		const operationId = crypto.randomUUID();
		void sendCommand({ type, operationId, nodeIds }).catch(() => {});
		return { operationId, nodes: nodeIds, status: "accepted" };
	},
	cancelOperation(operationId: string) {
		void sendCommand({ type: "cancel", operationId }).catch(() => {});
		return true;
	},
} as unknown as WsrtControlPlane;

const handle = await startDashboardInProcess(plane, workerData.options as DashboardOptions);
port.postMessage({
	type: "ready",
	handle: { url: handle.url, host: handle.host, port: handle.port, basePath: handle.basePath },
});

port.on("message", async (message) => {
	if (message.type === "snapshot") {
		snapshot = message.snapshot;
		for (const listener of subscribers) listener(snapshot.controlPlane);
	} else if (message.type === "command-result") {
		const waiter = pending.get(message.id);
		if (!waiter) return;
		pending.delete(message.id);
		message.error ? waiter.reject(new Error(message.error)) : waiter.resolve(message.value);
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
