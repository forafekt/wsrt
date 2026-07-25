import type { WorkerPoolLogger } from "./types.js";

export const noopLogger: Required<WorkerPoolLogger> = {
	debug() {},
	info() {},
	warn() {},
	error() {},
};

export function normalizeLogger(logger: WorkerPoolLogger | undefined): Required<WorkerPoolLogger> {
	return {
		debug: logger?.debug ?? noopLogger.debug,
		info: logger?.info ?? noopLogger.info,
		warn: logger?.warn ?? noopLogger.warn,
		error: logger?.error ?? noopLogger.error,
	};
}
