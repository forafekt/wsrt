export type StructuredEvent<Type extends string = string, Payload = unknown> = {
	id: string;
	sequence?: number;
	type: Type;
	timestamp: string;
	source: string;
	correlationId: string;
	causationId?: string;
	operationId?: string;
	payload: Payload;
};
export type EventQuery = {
	source?: string;
	type?: string;
	operationId?: string;
	correlationId?: string;
	sinceSequence?: number;
	since?: string;
};
export class EventJournal<Event extends StructuredEvent = StructuredEvent> extends EventTarget {
	readonly #history: Event[] = [];
	#sequence = 0;
	constructor(readonly maximumSize = 1_000) {
		super();
		if (maximumSize < 1) throw new Error("Event journal maximum size must be positive");
	}
	publish(input: Event): Event {
		const event = Object.freeze({
			...input,
			sequence: ++this.#sequence,
		}) as Event;
		this.#history.push(event);
		if (this.#history.length > this.maximumSize)
			this.#history.splice(0, this.#history.length - this.maximumSize);
		this.dispatchEvent(new CustomEvent(event.type, { detail: event }));
		return event;
	}
	subscribe<Type extends Event["type"]>(
		type: Type,
		listener: (event: Extract<Event, { type: Type }>) => void,
	): () => void {
		const handler = (event: globalThis.Event) => listener((event as CustomEvent).detail);
		this.addEventListener(type, handler);
		return () => this.removeEventListener(type, handler);
	}
	query(query: EventQuery = {}): readonly Event[] {
		return this.#history.filter(
			(event) =>
				(!query.source || event.source === query.source) &&
				(!query.type || event.type === query.type) &&
				(!query.operationId || event.operationId === query.operationId) &&
				(!query.correlationId || event.correlationId === query.correlationId) &&
				(!query.sinceSequence || (event.sequence ?? 0) > query.sinceSequence) &&
				(!query.since || event.timestamp >= query.since),
		);
	}
	list(): readonly Event[] {
		return this.query();
	}
	get sequence(): number {
		return this.#sequence;
	}
	clear(): void {
		this.#history.length = 0;
	}
}
export { EventJournal as EventStream };
