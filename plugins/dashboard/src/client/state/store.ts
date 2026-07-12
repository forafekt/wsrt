import type { DashboardSnapshot } from "../../shared/contracts.js";

export type DashboardState = Readonly<{
	snapshot?: DashboardSnapshot;
	selectedNode?: string;
	eventFilter: string;
	connected: boolean;
}>;
export type DashboardAction =
	| { type: "snapshot"; snapshot: DashboardSnapshot }
	| { type: "select-node"; id?: string }
	| { type: "filter-events"; value: string }
	| { type: "connected"; value: boolean };
export function reduceDashboardState(
	state: DashboardState,
	action: DashboardAction,
): DashboardState {
	if (action.type === "snapshot")
		return action.snapshot.revision <= (state.snapshot?.revision ?? -1)
			? state
			: Object.freeze({ ...state, snapshot: action.snapshot });
	if (action.type === "select-node")
		return Object.freeze({ ...state, selectedNode: action.id });
	if (action.type === "filter-events")
		return Object.freeze({ ...state, eventFilter: action.value });
	return Object.freeze({ ...state, connected: action.value });
}
export class DashboardStore {
	#state: DashboardState = Object.freeze({ eventFilter: "", connected: false });
	readonly #listeners = new Set<(state: DashboardState) => void>();
	get state() {
		return this.#state;
	}
	dispatch(action: DashboardAction) {
		const next = reduceDashboardState(this.#state, action);
		if (next === this.#state) return;
		this.#state = next;
		for (const listener of [...this.#listeners]) listener(next);
	}
	subscribe(listener: (state: DashboardState) => void) {
		this.#listeners.add(listener);
		listener(this.#state);
		return () => this.#listeners.delete(listener);
	}
}
