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
		const telemetryFile = path.join(
			os.tmpdir(),
			`wsrt-vite-${randomUUID()}.jsonl`,
		);
		return {
			command: "vite",
			args,
			shell: false,
			environment: {
				WSRT_EXECUTION_TELEMETRY: telemetryFile,
				WSRT_VITE_REPORT: "1",
			},
			metadata: { telemetryFile },
		};
	},
};

import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
