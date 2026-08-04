import { WorkbenchClientError } from "./errors.js";
import type { BootstrapPayload, WorkspaceRequestInput } from "./workspace-session.js";

export type WorkspaceClientOptions = Readonly<{
	basePath: string;
	fetcher?: typeof fetch;
}>;

export class WorkspaceClient {
	readonly #fetcher: typeof fetch;
	constructor(readonly options: WorkspaceClientOptions) {
		this.#fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
	}
	async bootstrap(signal?: AbortSignal): Promise<BootstrapPayload> {
		return this.#json<BootstrapPayload>("/api/bootstrap", { signal });
	}
	async request<T>(request: WorkspaceRequestInput, signal?: AbortSignal): Promise<T> {
		return this.#json<T>("/api/request", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(request),
			signal,
		});
	}
	eventsUrl() {
		return `${this.options.basePath}/api/events`;
	}
	async #json<T>(path: string, init: RequestInit = {}): Promise<T> {
		const response = await this.#fetcher(`${this.options.basePath}${path}`, init);
		let body: unknown;
		try {
			body = await response.json();
		} catch {
			body = undefined;
		}
		if (!response.ok) {
			const error = readProtocolError(body);
			throw new WorkbenchClientError(error.message, response.status, error.code);
		}
		return body as T;
	}
}

function readProtocolError(value: unknown) {
	if (!value || typeof value !== "object" || !("error" in value))
		return { message: "Workspace request failed", code: "workbench.request_failed" };
	const error = (value as { error?: { message?: unknown; code?: unknown } }).error;
	return {
		message: typeof error?.message === "string" ? error.message : "Workspace request failed",
		code: typeof error?.code === "string" ? error.code : "workbench.request_failed",
	};
}
