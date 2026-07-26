import type { DashboardContributionView, DashboardSnapshot } from "../../shared/contracts.js";

export type DashboardState = Readonly<{
	snapshot?: DashboardSnapshot;
	visibleEvents?: DashboardSnapshot["events"];
	selectedNode?: string;
	eventFilter: string;
	search: string;
	eventsPaused: boolean;
	virtualStart: number;
	lineWrap: boolean;
	graphKind: string;
	graphHealth: string;
	graphState: string;
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
	| { type: "virtual-window"; value: number }
	| { type: "line-wrap"; value: boolean }
	| { type: "graph-filter"; field: "kind" | "health" | "state"; value: string }
	| { type: "clear-visible-events" }
	| { type: "error"; value?: string }
	| { type: "connected"; value: boolean }
	| { type: "contributions"; value: readonly DashboardContributionView[] };

export function reduceDashboardState(
	state: DashboardState,
	action: DashboardAction,
): DashboardState {
	if (action.type === "snapshot") {
		if (
			action.snapshot.protocolVersion !== 3 ||
			action.snapshot.revision <= (state.snapshot?.revision ?? -1)
		)
			return state;
		return Object.freeze({
			...state,
			snapshot: action.snapshot,
			visibleEvents: state.eventsPaused
				? (state.visibleEvents ?? state.snapshot?.events ?? [])
				: action.snapshot.events,
		});
	}
	if (action.type === "select-node") return Object.freeze({ ...state, selectedNode: action.id });
	if (action.type === "filter-events")
		return Object.freeze({ ...state, eventFilter: action.value });
	if (action.type === "search") return Object.freeze({ ...state, search: action.value });
	if (action.type === "pause-events")
		return Object.freeze({
			...state,
			eventsPaused: action.value,
			visibleEvents: action.value
				? (state.visibleEvents ?? state.snapshot?.events ?? [])
				: (state.snapshot?.events ?? []),
		});
	if (action.type === "clear-visible-events")
		return Object.freeze({ ...state, visibleEvents: Object.freeze([]) });
	if (action.type === "virtual-window")
		return action.value === state.virtualStart
			? state
			: Object.freeze({ ...state, virtualStart: Math.max(0, action.value) });
	if (action.type === "line-wrap") return Object.freeze({ ...state, lineWrap: action.value });
	if (action.type === "graph-filter")
		return Object.freeze({ ...state, [`graph${capitalize(action.field)}`]: action.value });
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
		virtualStart: 0,
		lineWrap: false,
		graphKind: "",
		graphHealth: "",
		graphState: "",
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

function capitalize(value: string) {
	return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}
