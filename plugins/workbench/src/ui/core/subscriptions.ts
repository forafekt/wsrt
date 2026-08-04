import type { WorkspaceClient } from "./workspace-client.js";
import type { WorkspaceEventMessage } from "./workspace-session.js";

export class WorkspaceSubscriptions {
	#source?: EventSource;
	constructor(
		readonly client: WorkspaceClient,
		readonly onEvent: (event: WorkspaceEventMessage) => void,
		readonly onConnection: (connected: boolean) => void,
		readonly Source: typeof EventSource = EventSource,
	) {}
	start() {
		this.#source = new this.Source(this.client.eventsUrl());
		this.#source.addEventListener("connected", () => this.onConnection(true));
		this.#source.addEventListener("workspace", (event) => {
			this.onConnection(true);
			try {
				const value = JSON.parse((event as MessageEvent).data);
				this.onEvent(value.event ?? value);
			} catch {
				this.onConnection(false);
			}
		});
		this.#source.onerror = () => this.onConnection(false);
	}
	close() {
		this.#source?.close();
		this.onConnection(false);
	}
}
