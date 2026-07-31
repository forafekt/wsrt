import type { ControlPlaneState } from "./control-plane-state.js";

export class ArtifactManager {
	readonly #state: ControlPlaneState;
	constructor(state: ControlPlaneState) {
		this.#state = state;
	}
}
