import type { WorkspaceCapability } from "./view-model.js";

export function hasCapability(
	capabilities: readonly WorkspaceCapability[] | undefined,
	id: string,
): boolean {
	return capabilities?.some((capability) => capability.id === id && capability.available) ?? false;
}
