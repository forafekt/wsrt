import { Store } from "./store.js";

export type OperationState = Readonly<{
	busy: boolean;
	query: string;
	result?: unknown;
	error?: string;
}>;

export const operationState = new Store<OperationState>({
	busy: false,
	query: "",
});
