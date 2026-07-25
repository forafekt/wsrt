export type EnvironmentValue = string | number | boolean | null | undefined;
export type EnvironmentInput = Readonly<Record<string, EnvironmentValue>>;
export type ResolvedEnvironment = {
	values: Readonly<Record<string, string>>;
	masked: readonly string[];
};
export function resolveEnvironment(
	input: EnvironmentInput = {},
	base: Readonly<Record<string, string | undefined>> = {},
): ResolvedEnvironment {
	const values: Record<string, string> = {},
		masked: string[] = [];
	for (const [key, value] of Object.entries({ ...base, ...input })) {
		if (value === undefined || value === null) continue;
		values[key] = String(value);
		if (isSensitiveEnvironmentKey(key)) masked.push(key);
	}
	return { values: Object.freeze(values), masked: Object.freeze(masked) };
}
export function isSensitiveEnvironmentKey(key: string): boolean {
	return /(TOKEN|SECRET|PASSWORD|PRIVATE|CREDENTIAL|API_KEY)/i.test(key);
}
