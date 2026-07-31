import type { ProcessHandle, RuntimeInstance } from "@wsrt/capabilities";
import type { NormalizedExecutable } from "@wsrt/config";
import type { PluginContext } from "@wsrt/plugins";
import type { ArtifactManager } from "./artifact-manager.js";
import type { ControlPlaneState } from "./control-plane-state.js";
import type { EventJournal } from "./event-journal.js";
import type { HealthManager } from "./health-manager.js";
import type { PluginManager } from "./plugin-manager.js";
import { required } from "./utils.js";

export class ExecutionManager {
	constructor(
		private readonly state: ControlPlaneState,
		private readonly events: EventJournal,
		private readonly health: HealthManager,
		private readonly artifacts: ArtifactManager,
		private readonly plugins: PluginManager,
		private readonly changed: () => void,
		private readonly pluginContext: () => PluginContext,
	) {}

	handler(item: NormalizedExecutable) {
		return {
			start: ({ signal }: { signal: AbortSignal }) => this.start(item, signal),

			stop: () => this.stop(item),

			ready: ({ signal }: { signal: AbortSignal }) => this.ready(item, signal),
		};
	}

	private async start(item: NormalizedExecutable, signal: AbortSignal): Promise<void> {
		// TODO
		this.#assertMutable();
	}

	private async stop(item: NormalizedExecutable): Promise<void> {
		// TODO
	}

	private async ready(item: NormalizedExecutable, signal: AbortSignal): Promise<void> {
		// TODO
	}

	private async processExited(
		item: NormalizedExecutable,
		handle: ProcessHandle,
		exit: {
			code: number | null;
			signal: string | null;
		},
	): Promise<void> {
		//  TODO
	}

	private runtime(item: NormalizedExecutable): RuntimeInstance {
		const definition = required(this.state.definition, "Control plane is not loaded");

		return required(
			this.state.runtimes.get(definition.runtimes[item.runtime].provider),
			`Runtime unavailable: ${item.runtime}`,
		);
	}

	#assertMutable(): void {
		// if (this.options.allowMutations === false)
		// 	throw new Error("Mutating control-plane operations are disabled");
	}
}
