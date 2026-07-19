import path from "node:path";
import { resolveWorkspace } from "@wsrt/workspace";
import type { ViteBridge, VitePluginOptions } from "./types.js";

export async function createViteBridge(
	options: VitePluginOptions & {
		workspaceRoot: string;
		projectRoot?: string;
		nodeId?: string;
		environment?: Readonly<Record<string, string>>;
	},
): Promise<ViteBridge> {
	const workspaceRoot = path.resolve(options.workspaceRoot);
	const workspace = await resolveWorkspace({
		root: options.workspace?.root
			? path.resolve(workspaceRoot, options.workspace.root)
			: workspaceRoot,
		aliases: options.workspace?.aliases,
		dependencies: options.workspace?.dependencies,
		include: options.workspace?.include,
		exclude: options.workspace?.exclude,
		sourceEntries: options.workspace?.sourceEntries,
	});
	return Object.freeze({
		workspaceRoot,
		projectRoot: path.resolve(workspaceRoot, options.projectRoot ?? options.project ?? "."),
		nodeId: options.nodeId,
		aliases: workspace.aliases,
		workspace,
		environment: Object.freeze({ ...options.environment }),
	});
}
