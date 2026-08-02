import type { WsrtControlPlane } from "@wsrt/control-plane";
import { type DashboardActionDescriptor, protocolError } from "./protocol.js";

const ACTION_KINDS = new Set(["action", "command", "artifact-action", "operation-action"]);

export class DashboardActionRouter {
	constructor(readonly plane: WsrtControlPlane) {}
	list(): readonly DashboardActionDescriptor[] {
		const plugins = this.plane.snapshot().plugins;
		const seen = new Set<string>();
		return this.plane
			.pluginContributions("dashboard")
			.filter((item) => ACTION_KINDS.has(item.kind) && !!item.run)
			.map((item) => {
				const pluginId =
					plugins.find((plugin) =>
						plugin.contributions.some(
							(value) => value.kind === "dashboard" && value.id === item.id,
						),
					)?.id ?? "unknown";
				const id = `${pluginId}/${item.id}`;
				if (seen.has(id))
					throw protocolError("dashboard.action_duplicate", `Duplicate dashboard action ${id}`);
				seen.add(id);
				return {
					id,
					pluginId,
					title: item.title ?? item.id,
					...(item.description ? { description: item.description } : {}),
				};
			});
	}
	async invoke(id: string, input: unknown, signal: AbortSignal): Promise<unknown> {
		const descriptor = this.list().find((item) => item.id === id);
		if (!descriptor)
			throw protocolError("dashboard.action_not_found", `Dashboard action ${id} was not found`);
		const contributionId = id.slice(descriptor.pluginId.length + 1);
		const contribution = this.plane
			.pluginContributions("dashboard")
			.find((item) => item.id === contributionId && ACTION_KINDS.has(item.kind) && !!item.run);
		if (!contribution?.run)
			throw protocolError("dashboard.action_not_found", `Dashboard action ${id} was not found`);
		return this.plane.invokePluginContribution("dashboard", contribution.id, (context) =>
			contribution.run?.(input, context, signal),
		);
	}
}
