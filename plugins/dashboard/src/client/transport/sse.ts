import type { DashboardSnapshot } from "../../shared/contracts.js";
export type SnapshotTransportOptions = {
	snapshotUrl?: string;
	eventsUrl?: string;
	reconnectMs?: number;
	eventSource?: typeof EventSource;
	fetcher?: typeof fetch;
};
export class SnapshotTransport {
	#source?: EventSource;
	#timer?: ReturnType<typeof setTimeout>;
	#closed = false;
	#revision = -1;
	constructor(
		readonly onSnapshot: (snapshot: DashboardSnapshot) => void,
		readonly onConnection: (connected: boolean) => void,
		readonly options: SnapshotTransportOptions = {},
	) {}
	async start() {
		this.#closed = false;
		try {
			await this.refresh();
		} catch {
			this.onConnection(false);
		}
		this.#connect();
	}
	#url(path: string) {
		const base =
			document.querySelector<HTMLMetaElement>('meta[name="wsrt-base-path"]')
				?.content ?? "";
		return `${base}${path}`;
	}
	async refresh() {
		const response = await (this.options.fetcher ?? fetch)(
			this.options.snapshotUrl ?? this.#url("/api/snapshot"),
		);
		if (!response.ok)
			throw new Error(`Snapshot request failed: HTTP ${response.status}`);
		this.#apply((await response.json()) as DashboardSnapshot);
	}
	close() {
		this.#closed = true;
		this.#source?.close();
		if (this.#timer) clearTimeout(this.#timer);
		this.onConnection(false);
	}
	#connect() {
		if (this.#closed) return;
		const Source = this.options.eventSource ?? EventSource;
		this.#source = new Source(
			this.options.eventsUrl ?? this.#url("/api/stream"),
		);
		this.#source.onopen = () => this.onConnection(true);
		this.#source.onmessage = (event) =>
			this.#apply(JSON.parse(event.data) as DashboardSnapshot);
		this.#source.onerror = () => {
			this.onConnection(false);
			this.#source?.close();
			if (!this.#closed)
				this.#timer = setTimeout(() => {
					void this.refresh()
						.catch(() => undefined)
						.finally(() => this.#connect());
				}, this.options.reconnectMs ?? 1000);
		};
	}
	#apply(snapshot: DashboardSnapshot) {
		if (snapshot.revision <= this.#revision) return;
		this.#revision = snapshot.revision;
		this.onSnapshot(snapshot);
	}
}
