import { Store } from "./store.js";

export type RuntimeState = Readonly<{
	lastRevision?: number;
	activeOperations: number;
	healthAttention: number;
}>;

export const runtimeState = new Store<RuntimeState>({
	activeOperations: 0,
	healthAttention: 0,
});
