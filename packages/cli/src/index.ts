#!/usr/bin/env node
import process from "node:process";
import { createControlPlane } from "@wsrt/control-plane";
import {
	type ExecutableHandle,
	PluginSession,
	resolveWorkspacePlugins,
} from "@wsrt/plugins";

const args = process.argv.slice(2),
	command = args.shift() ?? "inspect";
let root: string | undefined,
	config: string | undefined,
	json = false;
const values: string[] = [];
const separator = args.indexOf("--"),
	forwarded = separator < 0 ? [] : args.splice(separator + 1);
if (separator >= 0) args.splice(separator, 1);
for (let i = 0; i < args.length; i++) {
	if (args[i] === "--root") root = args[++i];
	else if (args[i] === "--config") config = args[++i];
	else if (args[i] === "--json") json = true;
	else values.push(args[i]);
}
if (json) process.env.WSRT_JSON_OUTPUT = "1";
const plane = await createControlPlane({ root, config });
try {
	let result: unknown;
	switch (command) {
		case "exec": {
			result = await executeContribution(
				plane,
				values[0],
				parseForwardedOptions(forwarded),
				json,
			);
			break;
		}
		case "validate":
			result = plane.validate();
			break;
		case "inspect":
			result = plane.snapshot();
			break;
		case "status":
		case "health":
			result = plane.snapshot().nodes;
			break;
		case "events":
			result = plane.listEvents();
			break;
		case "operations":
			result = plane.listOperations();
			break;
		case "graph":
			result = plane.graph().toJSON();
			break;
		case "up":
			result = await plane.start();
			break;
		case "down":
			result = await plane.stop();
			break;
		case "start":
			result = await plane.start(values);
			break;
		case "stop":
			result = await plane.stop(values);
			break;
		case "restart":
			result = await plane.restart(values);
			break;
		case "run":
			if (!values[0]) throw new Error("Usage: wsrt run <task>");
			result = await plane.runTask(values[0]);
			break;
		case "artifacts":
			result = plane.listArtifacts();
			break;
		case "cancel":
			if (!values[0]) throw new Error("Usage: wsrt cancel <operation-id>");
			result = {
				operationId: values[0],
				cancelled: plane.cancelOperation(values[0]),
			};
			break;
		default:
			throw new Error(`Unknown command: ${command}`);
	}
	if (result !== undefined)
		console.log(JSON.stringify(result, null, json ? 2 : 0));
	if (
		["up", "start", "restart"].includes(command) &&
		plane.definition().executables.some((item) => item.kind !== "task")
	)
		await new Promise<void>((resolve) => {
			const close = async () => {
				await plane.dispose();
				resolve();
			};
			process.once("SIGINT", close);
			process.once("SIGTERM", close);
		});
} finally {
	if (!["up", "start", "restart"].includes(command)) await plane.dispose();
}

async function executeContribution(
	controlPlane: Awaited<ReturnType<typeof createControlPlane>>,
	id: string | undefined,
	options: Record<string, unknown>,
	jsonOutput: boolean,
) {
	const plugins = await resolveWorkspacePlugins(
			controlPlane.definition().plugins,
			controlPlane.definition().root,
		),
		session = new PluginSession(plugins);
	try {
		const executables = session.executables();
		if (!id || id === "--list") {
			if (jsonOutput)
				return executables.map(({ id, description, owner }) => ({
					id,
					description,
					owner,
				}));
			console.log(
				executables.length
					? `Available executables\n\n${executables.map((item) => `${item.id}\n  Plugin: ${item.owner.id}\n  Description: ${item.description ?? "—"}`).join("\n\n")}`
					: "Available executables\n\n  none",
			);
			return undefined;
		}
		const executable = session.executable(id);
		if (!executable)
			throw new Error(
				`WSRT_EXECUTABLE_NOT_FOUND: Executable "${id}" is not available.\n\nConfigured executable contributions:\n${executables.length ? executables.map((item) => `  ${item.id}`).join("\n") : "  none"}\n\nAdd and configure a plugin that provides it.`,
			);
		const validation = executable.validateOptions?.(options),
			validated =
				validation && "value" in validation ? validation.value : options;
		if (validation && !("value" in validation))
			throw new Error(
				`WSRT_EXECUTABLE_INVALID_OPTIONS: ${validation.diagnostics.map((item) => item.message).join("\n")}`,
			);
		const controller = new AbortController();
		let output: unknown;
		try {
			output = await executable.execute(
				{
					controlPlane,
					signal: controller.signal,
					logger: {
						info: console.log,
						warn: console.warn,
						error: console.error,
					},
				},
				validated,
			);
		} catch (cause) {
			throw new Error(
				`WSRT_EXECUTABLE_FAILED: ${cause instanceof Error ? cause.message : String(cause)}`,
				{ cause },
			);
		}
		if (!isHandle(output)) return output;
		let stopping = false;
		const close = async () => {
			if (stopping) return;
			stopping = true;
			controller.abort();
			await output.close();
		};
		process.once("SIGINT", close);
		process.once("SIGTERM", close);
		try {
			await output.wait?.();
			return output.result;
		} finally {
			process.off("SIGINT", close);
			process.off("SIGTERM", close);
			await close();
		}
	} finally {
		await session.dispose();
	}
}

function isHandle(value: unknown): value is ExecutableHandle {
	return (
		!!value &&
		typeof value === "object" &&
		"close" in value &&
		typeof value.close === "function"
	);
}
function parseForwardedOptions(args: string[]): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (!argument.startsWith("--"))
			throw new Error(
				`WSRT_EXECUTABLE_INVALID_OPTIONS: Unexpected argument ${argument}`,
			);
		const negative = argument.startsWith("--no-"),
			raw = argument.slice(negative ? 5 : 2),
			key = raw.replace(/-([a-z])/g, (_, letter: string) =>
				letter.toUpperCase(),
			);
		if (negative) result[key] = false;
		else if (args[index + 1] && !args[index + 1].startsWith("--")) {
			const value = args[++index];
			result[key] = /^\d+$/.test(value) ? Number(value) : value;
		} else result[key] = true;
	}
	return result;
}
