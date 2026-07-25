import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ArtifactProvider, ProcessHandle, ReadinessProvider } from "@wsrt/capabilities";
import { definePlugin, type ExecutableContribution, type WsrtPlugin } from "@wsrt/plugins";
import { createViteAdapter } from "./adapter.js";
import {
	createOwnedExecutionState,
	ExecutionTelemetryReader,
	type OwnedExecutionState,
	removeOwnedExecutionState,
} from "./telemetry.js";
import type { ViteAdapterOptions, VitePluginOptions } from "./types.js";

const packageMetadata = createRequire(import.meta.url)("../package.json") as {
	readonly name: string;
	readonly version: string;
};
const owner = { id: packageMetadata.name, version: packageMetadata.version } as const;
export default function vite(options: VitePluginOptions = {}): WsrtPlugin {
	const readiness: ReadinessProvider<ViteAdapterOptions> = {
		id: "vite",
		validate: (input) => ({
			options: isRecord(input) ? (input as ViteAdapterOptions) : {},
			diagnostics: [],
		}),
		async wait(_input, context) {
			if (context.signal.aborted)
				throw context.signal.reason ?? new Error("WSRT_READINESS_CANCELLED");
			if (!context.process?.running)
				throw new Error(`Vite process for ${context.nodeId} is not running`);
			const state = ownedState(context.executionMetadata.executionState);
			if (!state) return;
			const reader = new ExecutionTelemetryReader(state.telemetryFile, state.executionId);
			const deadline = Date.now() + 30_000;
			try {
				while (Date.now() < deadline) {
					if (context.signal.aborted)
						throw context.signal.reason ?? new Error("WSRT_READINESS_CANCELLED");
					if (!context.process.running)
						throw new Error(
							"WSRT_PROCESS_EXIT_BEFORE_READY: Vite exited before reporting readiness",
						);
					const records = await consumeTelemetry(reader, context.report);
					if (records.some((record) => record.event.type === "server.listening")) return;
					await context.capabilities.require("timers").delay(50, context.signal);
				}
				throw new Error("Timed out waiting for structured Vite readiness");
			} finally {
				await reader.close({ drain: !context.signal.aborted }).catch(() => []);
				await removeOwnedExecutionState(state).catch(() => {});
			}
		},
	};
	const artifacts: ArtifactProvider<ViteAdapterOptions> = {
		id: "vite",
		async collect(input, context) {
			if (input.command !== "build") return [];
			const state = ownedState(context.executionMetadata.executionState);
			if (state) {
				const reader = new ExecutionTelemetryReader(state.telemetryFile, state.executionId);
				try {
					await consumeTelemetry(reader, context.report);
				} finally {
					await reader.close({ drain: !context.signal.aborted }).catch(() => []);
					await removeOwnedExecutionState(state).catch(() => {});
				}
			}
			const outputRoot = path.resolve(
				context.projectRoot,
				argumentValue(input.args ?? [], "--outDir") ?? "dist",
			);
			const files = await walkFiles(outputRoot, context.signal);
			return files.map((file) => ({
				name: `vite-${path.relative(outputRoot, file).replaceAll(path.sep, "-")}`,
				path: path.relative(context.projectRoot, file),
				kind: "file",
				outputGroup: "vite-build",
				metadata: { provider: "vite" },
			}));
		},
	};
	const executable: ExecutableContribution<Record<string, unknown>> = {
		id: "vite",
		owner,
		description: "Run the installed Vite CLI with WSRT workspace context",
		async execute(context) {
			const plane = context.controlPlane as { definition(): { root: string } };
			const workspaceRoot = plane.definition().root;
			const cwd = path.resolve(workspaceRoot, options.project ?? ".");
			const runtime = await import("@wsrt/runtime-node");
			const instance = await new runtime.NodeRuntimeProvider().create();
			const configured = takeConfigArgument(context.arguments, cwd);
			const discovered = configured.file ?? (await findViteConfig(cwd));
			const executionState = createOwnedExecutionState();
			const wrapper = path.join(executionState.directory, "vite.config.mjs");
			const nativePlugin = new URL("./vite.js", import.meta.url).href;
			const userImport = discovered
				? `import userExport from ${JSON.stringify(pathToFileURL(discovered).href)};`
				: "const userExport = {};";
			try {
				await fs.writeFile(
					wrapper,
					`${userImport}\nimport { wsrt } from ${JSON.stringify(nativePlugin)};\nexport default async (env) => { const user = typeof userExport === 'function' ? await userExport(env) : await userExport; return { ...user, plugins: [...(user.plugins || []), wsrt(${JSON.stringify(options)})] }; };\n`,
				);
			} catch (cause) {
				await removeOwnedExecutionState(executionState).catch(() => {});
				await instance.dispose().catch(() => {});
				throw cause;
			}
			const args = [...configured.args, "--config", wrapper];
			let handle: ProcessHandle;
			try {
				handle = instance.capabilities.require("spawn").spawn({
					command: process.execPath,
					args: [viteExecutable(), ...(args.length > 2 ? args : ["dev", ...args])],
					cwd,
					environment: {
						WSRT_WORKSPACE_ROOT: workspaceRoot,
						WSRT_PROJECT_ROOT: cwd,
						WSRT_VITE_REPORT: "1",
						WSRT_EXECUTION_TELEMETRY: executionState.telemetryFile,
						WSRT_EXECUTION_ID: executionState.executionId,
					},
					signal: context.signal,
				});
			} catch (cause) {
				await removeOwnedExecutionState(executionState).catch(() => {});
				await instance.dispose().catch(() => {});
				throw cause;
			}
			return {
				wait: async () => {
					const exit = await handle.exit;
					if (exit.code && !context.signal.aborted)
						throw new Error(`Vite exited with code ${exit.code}`);
				},
				close: async () => {
					handle.terminate();
					await handle.exit;
					await instance.dispose();
					await removeOwnedExecutionState(executionState);
				},
			};
		},
	};
	return definePlugin({
		id: owner.id,
		name: "Vite",
		version: owner.version,
		description: "Vite execution, configuration, and workspace integration",
		capabilities: [
			"execution-provider",
			"readiness-provider",
			"artifact-provider",
			"workspace-provider",
			"dashboard",
		],
		contributions: {
			adapters: [createViteAdapter(options)],
			readiness: [readiness],
			artifacts: [artifacts],
			executables: [executable],
			dashboard: [
				{
					id: "vite-status",
					kind: "widget",
					title: "Vite",
					load: () => ({
						kind: "status",
						state: "configured",
						message: "Vite provider is active",
					}),
				},
			],
		},
	});
}

async function walkFiles(root: string, signal: AbortSignal): Promise<string[]> {
	const result: string[] = [];
	for (const entry of await fs.readdir(root, { withFileTypes: true })) {
		if (signal.aborted) throw signal.reason;
		const file = path.join(root, entry.name);
		if (entry.isDirectory()) result.push(...(await walkFiles(file, signal)));
		else if (entry.isFile()) result.push(file);
	}
	return result.sort();
}

function takeConfigArgument(
	args: readonly string[],
	cwd: string,
): { args: string[]; file?: string } {
	const result = [...(args.length ? args : ["dev"])];
	for (let index = 0; index < result.length; index++) {
		if (result[index] !== "--config" && result[index] !== "-c") continue;
		const value = result[index + 1];
		if (!value) return { args: result };
		result.splice(index, 2);
		return { args: result, file: path.resolve(cwd, value) };
	}
	return { args: result };
}
async function findViteConfig(root: string): Promise<string | undefined> {
	for (const name of [
		"vite.config.ts",
		"vite.config.mts",
		"vite.config.js",
		"vite.config.mjs",
		"vite.config.cts",
		"vite.config.cjs",
	]) {
		const file = path.join(root, name);
		try {
			await fs.access(file);
			return file;
		} catch {}
	}
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
function viteExecutable(): string {
	const require = createRequire(import.meta.url);
	return path.resolve(path.dirname(require.resolve("vite")), "../../bin/vite.js");
}
function argumentValue(args: readonly string[], name: string): string | undefined {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}
function ownedState(value: unknown): OwnedExecutionState | undefined {
	if (
		!isRecord(value) ||
		typeof value.executionId !== "string" ||
		typeof value.directory !== "string" ||
		typeof value.telemetryFile !== "string" ||
		typeof value.manifestFile !== "string"
	)
		return;
	return value as OwnedExecutionState;
}
async function consumeTelemetry(
	reader: ExecutionTelemetryReader,
	report: (event: import("@wsrt/capabilities").ExecutionTelemetryEvent) => void,
) {
	const result = await reader.read();
	for (const issue of result.issues)
		report({
			type: "diagnostic",
			diagnostic: {
				code: issue.code,
				severity: "warning",
				message: issue.message,
			},
		});
	for (const record of result.records) report(record.event);
	return result.records;
}
