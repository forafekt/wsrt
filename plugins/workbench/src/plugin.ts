import { createRequire } from "node:module";
import { definePlugin, type ExecutableContribution, type WsrtPlugin } from "@wsrt/plugins";
import { WorkspaceSessionClient } from "@wsrt/workspace-session";

export type WorkbenchOptions = {
	enabled?: boolean;
	host?: string;
	port?: number;
	strictPort?: boolean;
	basePath?: string;
	open?: boolean;
	mutations?: boolean;
	title?: string;
	maxResponseBytes?: number;
	maxRequestBytes?: number;
};

export const DEFAULT_WORKBENCH_OPTIONS = Object.freeze({
	enabled: true,
	host: "127.0.0.1",
	port: 5178,
	strictPort: true,
	basePath: "/__wsrt/workbench",
	open: false,
	mutations: true,
	title: "WSRT Workbench",
	maxResponseBytes: 8 * 1024 * 1024,
	maxRequestBytes: 128 * 1024,
});

export function normalizeWorkbenchOptions(
	input: WorkbenchOptions = {},
): Required<WorkbenchOptions> {
	const value = { ...DEFAULT_WORKBENCH_OPTIONS, ...input };
	if (!value.host || /[\s/]/.test(value.host))
		throw new Error(`Invalid workbench host: ${value.host}`);
	if (!Number.isInteger(value.port) || value.port < 0 || value.port > 65535)
		throw new Error(`Invalid workbench port: ${value.port}`);
	if (
		(value.basePath && !value.basePath.startsWith("/")) ||
		/[?#]/.test(value.basePath) ||
		value.basePath.includes("..")
	)
		throw new Error(`Invalid workbench base path: ${value.basePath}`);
	for (const [name, size] of [
		["maxResponseBytes", value.maxResponseBytes],
		["maxRequestBytes", value.maxRequestBytes],
	] as const)
		if (!Number.isSafeInteger(size) || size < 1024)
			throw new Error(`Invalid workbench ${name}: ${size}`);
	value.basePath = value.basePath === "/" ? "" : value.basePath.replace(/\/+$/, "");
	return value;
}

export function workbenchPlugin(options: WorkbenchOptions = {}): WsrtPlugin {
	const defaults = normalizeWorkbenchOptions(options);
	const metadata = createRequire(import.meta.url)("../package.json") as {
		name: string;
		version: string;
	};
	const owner = { id: metadata.name, version: metadata.version } as const;
	const executable: ExecutableContribution<WorkbenchOptions> = {
		id: "workbench",
		description: "Start the WSRT Workbench",
		owner,
		validateOptions(input) {
			try {
				return {
					value: normalizeWorkbenchOptions({ ...defaults, ...(record(input) ? input : {}) }),
				};
			} catch (cause) {
				return {
					diagnostics: [
						{
							code: "WSRT_EXECUTABLE_INVALID_OPTIONS",
							severity: "error",
							message: cause instanceof Error ? cause.message : String(cause),
						},
					],
				};
			}
		},
		async execute(context, executableOptions) {
			if (!(context.controlPlane instanceof WorkspaceSessionClient))
				throw new Error("Workbench requires an authoritative workspace session client");
			const { startWorkbench } = await import("./server.js");
			const handle = await startWorkbench(context.controlPlane, executableOptions);
			context.logger.info(`WSRT Workbench: ${handle.url}`);
			let release = () => {};
			const waiting = new Promise<void>((resolve) => {
				release = resolve;
			});
			let closed = false;
			const close = async () => {
				if (closed) return;
				closed = true;
				context.signal.removeEventListener("abort", close);
				await handle.close();
				release();
			};
			context.signal.addEventListener("abort", close, { once: true });
			return { result: { url: handle.url }, wait: () => waiting, close };
		},
	};
	return definePlugin({
		...owner,
		name: "WSRT Workbench",
		description: "Semantic workspace interface and operating layer",
		capabilities: ["cli"],
		contributions: { executables: [executable] },
	});
}

function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
