import type { WsrtControlPlane } from "@wsrt/control-plane";
import { DASHBOARD_PROTOCOL } from "./shared/contracts.js";

export function dashboardSnapshot(plane: WsrtControlPlane) {
	const snapshot = plane.snapshot();
	return {
		protocolVersion: 3 as const,
		protocol: DASHBOARD_PROTOCOL,
		revision: snapshot.revision,
		controlPlane: snapshot,
		graph: safeSerializable(plane.graph().toJSON()),
		events: plane.listEvents().map((event) => ({
			...event,
			payload: boundedValue(event.payload),
		})),
		configuration: safeSerializable(plane.definition()),
		contributions: safeSerializable(plane.pluginContributions("dashboard")),
	};
}

export function dashboardOperation(
	plane: WsrtControlPlane,
	operation: "start" | "stop" | "restart" | "run",
	ids: string[],
) {
	if (operation === "run" && ids.length !== 1)
		throw new Error("Task operation requires exactly one task");
	return plane.submit(operation === "run" ? "task" : operation, ids);
}

export function dashboardCancelOperation(plane: WsrtControlPlane, operationId: string) {
	return { operationId, cancelled: plane.cancelOperation(operationId) };
}

export function safeSerializable(value: unknown): unknown {
	const seen = new WeakSet<object>();
	return JSON.parse(
		JSON.stringify(value, (key, item) => {
			if (/(?:secret|token|password|private.?key|credential)/i.test(key)) return "[REDACTED]";
			if (typeof item === "function" || typeof item === "symbol") return undefined;
			if (item && typeof item === "object") {
				if (seen.has(item)) return "[CIRCULAR]";
				seen.add(item);
			}
			return item;
		}),
	);
}

function boundedValue(value: unknown): unknown {
	try {
		const encoded = JSON.stringify(value);
		if (!encoded || encoded.length <= 65_536) return safeSerializable(value);
		return {
			truncated: true,
			originalBytes: Buffer.byteLength(encoded),
			preview: encoded.slice(0, 4096),
		};
	} catch {
		return { truncated: true, reason: "Event payload was not serializable" };
	}
}
