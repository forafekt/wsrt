import { fromDotEnv } from "./dot-env.ts";

export function unstable_fromDotEnvs(
	mode: string,
	envDir: string | false,
	prefixes: string | string[] = "BOOTLANE_",
) {
	let cache: Record<string, string> | null = null;

	return () => {
		if (cache) return cache;
		cache = {};

		prefixes = typeof prefixes === "string" ? prefixes.split(",") : prefixes;
		const envFiles = getEnvFilesForMode(mode, envDir);
		const parsed = Object.fromEntries(
			envFiles.flatMap((filePath) => {
				return Object.entries(fromDotEnv(filePath)());
			}),
		);

		// only keys that start with prefix are exposed to client
		for (const [key, value] of Object.entries(parsed)) {
			if (prefixes.some((prefix) => key.startsWith(prefix))) {
				cache[key] = value;
			}
		}
		return cache;
	};
}

function getEnvFilesForMode(mode: string, envDir: string | false): string[] {
	if (envDir !== false) {
		return [
			/** default file */ `.env`,
			/** local file */ `.env.local`,
			/** mode file */ `.env.${mode}`,
			/** mode local file */ `.env.${mode}.local`,
		].map((file) => join(envDir, file));
	}

	return [];
}

function _resolveEnvPrefix({
	envPrefix = "BOOTLANE_",
}: {
	envPrefix?: string | string[];
}): string[] {
	envPrefix = typeof envPrefix === "string" ? envPrefix.split(",") : envPrefix;
	if (envPrefix.includes("")) {
		throw new Error(
			`envPrefix option contains value '', which could lead unexpected exposure of sensitive information.`,
		);
	}
	if (envPrefix.some((prefix) => /\s/.test(prefix))) {
		// eslint-disable-next-line no-console
		console.warn(
			`[bootlane] Warning: envPrefix option contains values with whitespace, which does not work in practice.`,
		);
	}
	return envPrefix;
}

// TODO: Move to utils
function join(base: string, ...paths: string[]): string {
	function cleanString(str: string): string {
		// Remove leading slashes
		str = str.replace(/^\/+/, "");
		// Remove trailing slashes
		str = str.replace(/\/+$/, "");
		// Replace multiple slashes with single slash
		str = str.replace(/\/+/g, "/");
		return str;
	}
	const cleanedBase = cleanString(base);
	const cleanedPaths = paths.map(cleanString);
	return [cleanedBase, ...cleanedPaths].join("/");
}
