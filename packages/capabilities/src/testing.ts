import type { ExecutionAdapter, ExecutionTelemetryEvent } from "./index.js";

export type ExecutionAdapterContractOptions<Options> = {
	readonly validOptions: Options;
	readonly invalidOptions?: unknown;
	executionId?(metadata: Readonly<Record<string, unknown>> | undefined): string | undefined;
};

export type ExecutionAdapterContractResult = {
	readonly id: string;
	readonly command: string;
	readonly arguments: readonly string[];
	readonly concurrentExecutionIds?: readonly [string, string];
};

/**
 * Reusable contract probe for execution adapters. It intentionally has no
 * dependency on a test runner so plugin packages can use it with node:test,
 * Vitest, or another harness.
 */
export async function exerciseExecutionAdapterContract<Options>(
	adapter: ExecutionAdapter<Options>,
	options: ExecutionAdapterContractOptions<Options>,
): Promise<ExecutionAdapterContractResult> {
	if (!adapter.id) throw contractFailure("provider identity is empty");
	const validated = adapter.validate(options.validOptions);
	if (!validated.options || validated.diagnostics.length)
		throw contractFailure("valid options were rejected");
	if (options.invalidOptions !== undefined) {
		const invalid = adapter.validate(options.invalidOptions);
		if (invalid.options && !invalid.diagnostics.length)
			throw contractFailure("invalid options were accepted without diagnostics");
	}
	const first = adapter.prepare(validated.options);
	const second = adapter.prepare(validated.options);
	try {
		if (!first.command || !Array.isArray(first.args))
			throw contractFailure("prepare did not return a command and argument list");
		if (
			first.command !== second.command ||
			JSON.stringify(first.args) !== JSON.stringify(second.args)
		)
			throw contractFailure("normalized command or arguments are nondeterministic");
		const left = options.executionId?.(first.metadata);
		const right = options.executionId?.(second.metadata);
		if (left !== undefined && (!right || left === right))
			throw contractFailure("concurrent execution identities are not isolated");
		return Object.freeze({
			id: adapter.id,
			command: first.command,
			arguments: Object.freeze([...first.args]),
			...(left && right
				? {
						concurrentExecutionIds: Object.freeze([left, right]) as readonly [string, string],
					}
				: {}),
		});
	} finally {
		await first.dispose?.();
		await first.dispose?.();
		await second.dispose?.();
	}
}

export type ExecutionProviderProbe = {
	readonly executionId: string;
	readonly events: readonly ExecutionTelemetryEvent[];
	readonly closed: boolean;
	cancel(): void;
	close(): void | Promise<void>;
};

export async function exerciseExecutionProviderLifecycle(
	start: (signal: AbortSignal) => ExecutionProviderProbe | Promise<ExecutionProviderProbe>,
): Promise<void> {
	const controller = new AbortController();
	const probe = await start(controller.signal);
	if (!probe.executionId) throw contractFailure("execution identity is empty");
	controller.abort(new DOMException("Contract cancellation", "AbortError"));
	probe.cancel();
	await probe.close();
	await probe.close();
	if (!probe.closed) throw contractFailure("cleanup is not idempotently closed");
}

function contractFailure(message: string): Error {
	return new Error(`WSRT_EXECUTION_PROVIDER_CONTRACT_FAILED: ${message}`);
}
