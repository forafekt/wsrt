import type { PluginContext } from "@wsrt/plugins";
import type { ControlPlaneState } from "./control-plane-state.js";
import { required } from "./utils.js";

export class CompletionService {
	constructor(
		private readonly state: ControlPlaneState,
		private readonly snapshot: () => {
			plugins: readonly { id: string }[];
		},
		private readonly pluginContext: () => PluginContext,
	) {}

	async complete(input: string): Promise<readonly string[]> {
		const definition = required(this.state.definition, "Control plane is not loaded");

		const pluginSession = required(this.state.pluginSession, "Control plane is not loaded");

		const values = new Set<string>();

		for (const executable of definition.executables) {
			values.add(executable.id);
			values.add(executable.name);
		}

		for (const plugin of this.snapshot().plugins) {
			values.add(plugin.id);
		}

		for (const providerId of this.state.providerIds) {
			values.add(providerId);
		}

		for (const executable of pluginSession.executables()) {
			values.add(executable.id);
		}

		for (const contribution of pluginSession.contributions("completion")) {
			try {
				const completions = await pluginSession.invoke(
					"completion",
					contribution.id,
					this.pluginContext(),
					(context) => contribution.complete(input, context),
				);

				for (const value of completions) {
					values.add(value);
				}
			} catch {
				// A broken optional completion provider should not break
				// completion from the remaining sources.
			}
		}

		return Object.freeze([...values].filter((value) => value.startsWith(input)).sort());
	}
}
