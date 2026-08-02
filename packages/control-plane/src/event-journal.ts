import type { ControlPlaneState } from "./control-plane-state.js";
import type { WorkspaceEvent } from "./types.js";

export interface EventSink {
	persist(event: WorkspaceEvent): void;
	changed(): void;
}

export class EventJournal {
	constructor(
		private readonly state: ControlPlaneState,
		private readonly sink: EventSink,
		private readonly limit = 1000,
	) {}

	list(): readonly WorkspaceEvent[] {
		return [...this.state.events];
	}

	emit(type: string, source: string, correlationId: string, payload: unknown): WorkspaceEvent {
		const event: WorkspaceEvent = {
			id: crypto.randomUUID(),
			type,
			timestamp: new Date().toISOString(),
			source,
			correlationId,
			payload,
		};

		this.state.events.push(event);
		if (this.state.events.length > this.limit) this.state.events.shift();
		this.sink.persist(event);
		this.sink.changed();
		return event;
	}
}
