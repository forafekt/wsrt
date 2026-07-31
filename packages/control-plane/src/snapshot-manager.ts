import type { ControlPlaneState } from "./control-plane-state.js";
import type { ControlPlaneSnapshot } from "./types.js";
import { required } from "./utils.js";

export class SnapshotManager {
	readonly #subscribers = new Set<(snapshot: ControlPlaneSnapshot) => void>();

	constructor(
		private readonly state: ControlPlaneState,
		private readonly getNodeState: (id: string) => string | undefined,
		private readonly onChanged?: () => void,
	) {}

	create(): ControlPlaneSnapshot {
		const definition = required(this.state.definition, "Control plane is not loaded");
		const nodes = definition.executables
			.map((item) =>
				Object.freeze({
					id: item.id,
					kind: item.kind,
					state: this.getNodeState(item.id) ?? "resolved",
					health: this.state.health.get(item.id) ?? "unknown",
					runtime: item.runtime,
					pid: this.state.handles.get(item.id)?.pid,
					terminationState: this.state.handles.get(item.id)?.terminationState,
					restartCount: 0,
					consecutiveSuccesses: 0,
					consecutiveFailures: 0,
					restartPending: false,
					currentRestartAttempt: 0,
					...this.state.healthDetails.get(item.id),
				}),
			)
			.sort((a, b) => a.id.localeCompare(b.id));

		return Object.freeze({
			revision: this.state.revision,
			generatedAt: new Date().toISOString(),
			workspace: Object.freeze({ name: definition.name, root: definition.root }),
			nodes: Object.freeze(nodes),
			operations: Object.freeze(structuredClone(this.state.operations)),
			artifacts: Object.freeze(
				structuredClone(
					[...this.state.artifacts.values()].sort((a, b) => a.id.localeCompare(b.id)),
				),
			),
			diagnostics: Object.freeze([...this.state.diagnostics]),
			events: Object.freeze({ size: this.state.events.length }),
			plugins: this.state.pluginSession?.snapshots() ?? [],
			providers: Object.freeze(
				this.state.providerIds.map((id) => Object.freeze({ id, kind: "runtime" as const })),
			),
		}) as ControlPlaneSnapshot;
	}

	subscribe(listener: (snapshot: ControlPlaneSnapshot) => void): () => void {
		this.#subscribers.add(listener);
		if (!this.state.disposed) {
			try {
				listener(this.create());
			} catch {}
		}
		return () => this.#subscribers.delete(listener);
	}

	changed(): void {
		this.state.revision += 1;
		const snapshot = this.create();
		for (const subscriber of this.#subscribers) {
			try {
				subscriber(snapshot);
			} catch {}
		}
		this.onChanged?.();
	}

	clear(): void {
		this.#subscribers.clear();
	}
}
