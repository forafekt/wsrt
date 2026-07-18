import { randomInt } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import type { ExecutionAdapter } from "@wsrt/capabilities";
import {
	createOwnedExecutionState,
	removeOwnedExecutionState,
} from "./telemetry.js";
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
		const selectedPort =
			options.port === 0 ? randomInt(30_000, 60_000) : options.port;
		if (selectedPort !== undefined) args.push("--port", String(selectedPort));
		if (options.port === 0) args.push("--strictPort");
		const executionState = createOwnedExecutionState();
		return {
			command: process.execPath,
			args: [viteExecutable(), ...args],
			shell: false,
			environment: {
				WSRT_EXECUTION_TELEMETRY: executionState.telemetryFile,
				WSRT_EXECUTION_ID: executionState.executionId,
				WSRT_VITE_REPORT: "1",
			},
			metadata: { executionState },
			dispose: () => removeOwnedExecutionState(executionState),
		};
	},
};

function viteExecutable(): string {
	const require = createRequire(import.meta.url);
	return path.resolve(
		path.dirname(require.resolve("vite")),
		"../../bin/vite.js",
	);
}
