import type { PluginContext, PluginContributions, PluginSession } from "@wsrt/plugins";
import { required } from "./utils.js";

export class PluginManager {
	constructor(
		private readonly session: () => PluginSession | undefined,
		private readonly context: () => PluginContext,
	) {}

	contributions<Kind extends keyof PluginContributions>(kind: Kind) {
		return required(this.session(), "Control plane is not loaded").contributions(kind);
	}

	invoke<T>(
		kind: keyof PluginContributions,
		id: string,
		run: (context: PluginContext) => T | Promise<T>,
	): Promise<T> {
		return required(this.session(), "Control plane is not loaded").invoke(
			kind,
			id,
			this.context(),
			run,
		);
	}
}
