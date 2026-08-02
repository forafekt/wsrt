export function required<T>(value: T | undefined, message: string): T {
	if (value === undefined) throw new Error(message);
	return value;
}

export function processShorthand(id: string): string | undefined {
	const match = /^application:([^/]+)\/process:(.+)$/.exec(id);
	return match ? `${match[1]}.${match[2]}` : undefined;
}

export function canonicalProcessId(value: string): string {
	const match = /^process:([^/]+)\/(.+)$/.exec(value);
	return match ? `application:${match[1]}/process:${match[2]}` : value;
}
