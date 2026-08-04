import type { WorkspaceSnapshot } from "../core/view-model.js";
import type { BootstrapPayload } from "../core/workspace-session.js";
import { Store } from "./store.js";

export type WorkspaceState = Readonly<{
	loading: boolean;
	connected: boolean;
	stale: boolean;
	error?: string;
	data?: BootstrapPayload;
}>;

export const workspaceState = new Store<WorkspaceState>({
	loading: true,
	connected: false,
	stale: false,
});

export function unwrapResult<T>(value: T | Readonly<{ result: T }> | undefined): T | undefined {
	return value && typeof value === "object" && "result" in value
		? (value as Readonly<{ result: T }>).result
		: (value as T | undefined);
}

export function description(state = workspaceState.get()): WorkspaceSnapshot | undefined {
	return unwrapResult(state.data?.description);
}
