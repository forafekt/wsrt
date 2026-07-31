import type { SystemDiagnostic } from "@wsrt/config";
import type { ControlPlaneState } from "./control-plane-state.js";
import type { EventJournal } from "./event-journal.js";
import type { PersistenceManager } from "./persistence-manager.js";
import type { OperationResult, OperationSnapshot } from "./types.js";

export class OperationManager {
	constructor(
		private readonly state: ControlPlaneState,
		private readonly events: EventJournal,
		private readonly persistence: PersistenceManager,
		private readonly changed: () => void,
		private readonly getNodeState: (id: string) => string | undefined,
	) {}

	list(): readonly OperationSnapshot[] {
		return Object.freeze([...this.state.operations]);
	}

	get(id: string): OperationSnapshot | undefined {
		return this.state.operations.find((item) => item.id === id);
	}

	cancel(id: string): boolean {
		const controller = this.state.operationControllers.get(id);
		if (!controller || controller.signal.aborted) return false;
		controller.abort(new DOMException("Operation cancelled", "AbortError"));
		this.events.emit("operation.cancelled", id, id, { operationId: id });
		return true;
	}

	async run(
		type: OperationSnapshot["type"],
		requested: readonly string[],
		affected: readonly string[],
		execute: (signal: AbortSignal) => Promise<void>,
	): Promise<OperationResult> {
		const conflict = affected.map((node) => this.state.nodeOperations.get(node)).find(Boolean);
		if (conflict) throw new Error(`WSRT_OPERATION_CONFLICT: operation ${conflict} is running`);

		const id = this.state.submittedOperationIds.shift() ?? crypto.randomUUID();
		let operation: OperationSnapshot = Object.freeze({
			id,
			type,
			status: "running",
			requestedNodes: Object.freeze([...requested]),
			affectedNodes: Object.freeze([...affected]),
			startedAt: new Date().toISOString(),
			correlationId: crypto.randomUUID(),
			diagnostics: Object.freeze([]),
			results: Object.freeze([]),
		});
		this.state.operations.push(operation);
		if (this.state.operations.length > 100) this.state.operations.shift();
		const controller = new AbortController();
		this.state.operationControllers.set(id, controller);
		for (const node of affected) this.state.nodeOperations.set(node, id);
		this.changed();
		await this.persistence.persistOperation(operation);

		try {
			await execute(controller.signal);
			if (controller.signal.aborted) throw controller.signal.reason;
			const results = affected.map((nodeId) =>
				Object.freeze({
					nodeId,
					status: "completed" as const,
					changed: true,
					diagnostics: Object.freeze([]),
				}),
			);
			operation = Object.freeze({
				...operation,
				status: "completed",
				completedAt: new Date().toISOString(),
				results: Object.freeze(results),
			});
			return this.#result(id, affected, "completed", results);
		} catch (cause) {
			const cancelled =
				controller.signal.aborted || (cause instanceof DOMException && cause.name === "AbortError");
			const diagnostic: SystemDiagnostic = {
				code: cancelled ? "WSRT_OPERATION_CANCELLED" : "WSRT_OPERATION_PARTIAL_FAILURE",
				severity: "error",
				message: cause instanceof Error ? cause.message : String(cause),
				source: { file: this.state.definition?.sourceFile ?? "<control-plane>", path: "" },
			};
			const results = affected.map((nodeId) =>
				Object.freeze({
					nodeId,
					status: cancelled
						? ("cancelled" as const)
						: this.getNodeState(nodeId) === "blocked"
							? ("blocked" as const)
							: ("failed" as const),
					changed: false,
					diagnostics: Object.freeze([diagnostic]),
				}),
			);
			operation = Object.freeze({
				...operation,
				status: cancelled ? "cancelled" : "failed",
				completedAt: new Date().toISOString(),
				diagnostics: Object.freeze([diagnostic]),
				results: Object.freeze(results),
			});
			if (!cancelled) throw cause;
			return this.#result(id, affected, "cancelled", results);
		} finally {
			const index = this.state.operations.findIndex((item) => item.id === id);
			if (index >= 0) this.state.operations[index] = operation;
			await this.persistence.persistOperation(operation);
			this.state.operationControllers.delete(id);
			for (const node of affected)
				if (this.state.nodeOperations.get(node) === id) this.state.nodeOperations.delete(node);
			this.changed();
		}
	}

	#result(
		id: string,
		ids: readonly string[],
		status: OperationResult["status"],
		results: OperationResult["results"],
	): OperationResult {
		return {
			operationId: id,
			nodes: ids,
			states: Object.fromEntries(
				ids.map((nodeId) => [nodeId, this.getNodeState(nodeId) ?? "resolved"]),
			) as OperationResult["states"],
			status,
			results,
		};
	}
}
