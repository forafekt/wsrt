import type { DashboardContributionView, DashboardSnapshot } from "../../shared/contracts.js";

export type DashboardState = Readonly<{
	snapshot?: DashboardSnapshot;
	selectedNode?: string;
	eventFilter: string;
	search: string;
	eventsPaused: boolean;
	error?: string;
	connected: boolean;
	contributions: readonly DashboardContributionView[];
}>;
export type DashboardAction =
	| { type: "snapshot"; snapshot: DashboardSnapshot }
	| { type: "select-node"; id?: string }
	| { type: "filter-events"; value: string }
	| { type: "search"; value: string }
	| { type: "pause-events"; value: boolean }
	| { type: "error"; value?: string }
	| { type: "connected"; value: boolean }
	| { type: "contributions"; value: readonly DashboardContributionView[] };
export function reduceDashboardState(
	state: DashboardState,
	action: DashboardAction,
): DashboardState {
	if (action.type === "snapshot")
		return action.snapshot.revision <= (state.snapshot?.revision ?? -1)
			? state
			: Object.freeze({ ...state, snapshot: action.snapshot });
	if (action.type === "select-node") return Object.freeze({ ...state, selectedNode: action.id });
	if (action.type === "filter-events")
		return Object.freeze({ ...state, eventFilter: action.value });
	if (action.type === "search") return Object.freeze({ ...state, search: action.value });
	if (action.type === "pause-events")
		return Object.freeze({ ...state, eventsPaused: action.value });
	if (action.type === "error") return Object.freeze({ ...state, error: action.value });
	if (action.type === "contributions")
		return Object.freeze({
			...state,
			contributions: Object.freeze([...action.value]),
		});
	return Object.freeze({ ...state, connected: action.value });
}
export class DashboardStore {
	#state: DashboardState = Object.freeze({
		eventFilter: "",
		search: "",
		eventsPaused: false,
		connected: false,
		contributions: Object.freeze([]),
	});
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
