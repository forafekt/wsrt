import path from "node:path";
import type { Plugin } from "vite";
import { mergeAliases } from "./aliases.js";
import { createViteBridge } from "./bridge.js";
import type { ViteBridge, VitePluginOptions } from "./types.js";

export function wsrt(
	options: VitePluginOptions & { bridge?: ViteBridge } = {},
): Plugin {
	let bridge = options.bridge;
	return {
		name: "wsrt:workspace",
		enforce: "pre",
		async config(config) {
			bridge ??= await createViteBridge({
				...options,
				workspaceRoot: await findWorkspaceRoot(
					path.resolve(config.root ?? process.cwd()),
				),
				projectRoot: config.root,
			});
			return {
				resolve: {
					alias: mergeAliases(
						config.resolve?.alias,
						bridge.aliases,
						options.aliasPrecedence,
					),
				},
				define: {
					"import.meta.env.WSRT_WORKSPACE_ROOT": JSON.stringify(
						bridge.workspaceRoot,
					),
					"import.meta.env.WSRT_PROJECT_ROOT": JSON.stringify(
						bridge.projectRoot,
					),
				},
			};
		},
		configureServer(server) {
			server.httpServer?.once("listening", () => {
				const address = server.httpServer?.address();
				process.emitWarning(
					address && typeof address === "object"
						? `WSRT_VITE_READY ${address.address}:${address.port}`
						: "WSRT_VITE_READY",
				);
			});
		},
		generateBundle(_options, bundle) {
			if (process.env.WSRT_VITE_REPORT === "1")
				for (const file of Object.keys(bundle))
					process.stderr.write(`WSRT_VITE_ARTIFACT ${file}\n`);
		},
	};
}
async function findWorkspaceRoot(start: string): Promise<string> {
	let current = start;
	while (true) {
		for (const file of ["pnpm-workspace.yaml", "wsrt.config.ts", "wsrt.yaml"])
			try {
				await import("node:fs/promises").then(({ access }) =>
					access(path.join(current, file)),
				);
				return current;
			} catch {}
		const parent = path.dirname(current);
		if (parent === current) return start;
		current = parent;
	}
}
export default wsrt;
