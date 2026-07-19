export type SerializedError = {
	name: string;
	message: string;
	stack?: string;
	code?: string;
	cause?: SerializedError;
};

export function serializeError(error: unknown): SerializedError {
	if (error instanceof Error) {
		const codedError = error as Error & { code?: unknown; cause?: unknown };
		return {
			name: error.name,
			message: error.message,
			stack: error.stack,
			code: typeof codedError.code === "string" ? codedError.code : undefined,
			cause: codedError.cause ? serializeError(codedError.cause) : undefined,
		};
	}

	return {
		name: "Error",
		message: typeof error === "string" ? error : JSON.stringify(error),
	};
}

export function reconstructError(serialized: SerializedError): Error {
	const error = new Error(serialized.message);
	error.name = serialized.name;
	error.stack = serialized.stack;
	if (serialized.code) {
		(error as Error & { code?: string }).code = serialized.code;
	}
	if (serialized.cause) {
		(error as Error & { cause?: Error }).cause = reconstructError(serialized.cause);
	}
	return error;
}
