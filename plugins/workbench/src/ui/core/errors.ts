export class WorkbenchClientError extends Error {
	constructor(
		message: string,
		readonly status?: number,
		readonly code?: string,
	) {
		super(message);
	}
}

export function messageFromCause(cause: unknown) {
	return cause instanceof Error ? cause.message : String(cause);
}
