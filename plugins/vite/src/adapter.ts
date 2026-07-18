import type { ExecutionAdapter } from "@wsrt/capabilities";
import type { ViteAdapterOptions } from "./types.js";

export const viteAdapter: ExecutionAdapter<ViteAdapterOptions> = {
	id: "vite",
	validate(input) {
		if (input && typeof input !== "object")
			return { diagnostics: ["Vite adapter options must be an object"] };
		const options = (input ?? {}) as ViteAdapterOptions;
		return {
			options,
			diagnostics:
				options.command &&
				!["dev", "build", "preview"].includes(options.command)
					? [`Unsupported Vite command: ${options.command}`]
					: [],
		};
	},
	prepare(options) {
		const args = [options.command ?? "dev", ...(options.args ?? [])];
		if (options.configFile) args.push("--config", options.configFile);
		if (options.host) args.push("--host", options.host);
		if (options.port) args.push("--port", String(options.port));
		return { command: "vite", args, shell: false };
	},
};
