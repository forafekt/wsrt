import type { createControlPlane } from "@wsrt/control-plane";
import {
	type ExecutableHandle,
	PluginSession,
	resolveWorkspacePlugins,
} from "@wsrt/plugins";

type ControlPlane = Awaited<ReturnType<typeof createControlPlane>>;

export async function executeContribution(
	controlPlane: ControlPlane,
	id: string | undefined,
	options: Record<string, unknown>,
	listOnly: boolean,
): Promise<unknown> {
	const plugins = await resolveWorkspacePlugins(
		controlPlane.definition().plugins,
		controlPlane.definition().root,
	);
	const session = new PluginSession(plugins);
	try {
		const executables = session.executables();
		if (!id || listOnly)
			return executables.map(({ id, description, owner }) => ({
				id,
				description,
				owner,
			}));
		const executable = session.executable(id);
		if (!executable)
			throw new Error(
				`WSRT_EXECUTABLE_NOT_FOUND: Executable "${id}" is not available.\n\nConfigured executable contributions:\n${executables.length ? executables.map((item) => `  ${item.id}`).join("\n") : "  none"}\n\nAdd and configure a plugin that provides it.`,
			);
		const validation = executable.validateOptions?.(options);
		const validated =
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

export function parseForwardedOptions(
	args: readonly string[],
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (!argument.startsWith("--"))
			throw new Error(
				`WSRT_EXECUTABLE_INVALID_OPTIONS: Unexpected argument ${argument}`,
			);
		const negative = argument.startsWith("--no-");
		const raw = argument.slice(negative ? 5 : 2);
		const key = raw.replace(/-([a-z])/g, (_, letter: string) =>
			letter.toUpperCase(),
		);
		if (negative) result[key] = false;
		else if (args[index + 1] && !args[index + 1].startsWith("--")) {
			const value = args[++index];
			result[key] = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
		} else result[key] = true;
	}
	return result;
}
