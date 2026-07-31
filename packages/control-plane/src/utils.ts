export function required<T>(value: T | undefined, message: string): T {
	if (value === undefined) throw new Error(message);
	return value;
}

export function processShorthand(id: string): string | undefined {
	const match = /^application:([^/]+)\/process:(.+)$/.exec(id);
	return match ? `${match[1]}.${match[2]}` : undefined;
}
