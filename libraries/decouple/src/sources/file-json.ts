import { DecoupleError } from "../errors.ts";

export function unstable_fromJsonFile(path: string | undefined) {
	let cache: Record<string, string> | null = null;

	return () => {
		if (cache) return cache;
		if (!path) {
			throw new DecoupleError("Path to JSON file is required");
		}

		try {
			// TODO: later to migrate to WSRT auto runtime detection, for now we will assume Deno is available in the environment
			if (typeof Deno === "undefined") {
				throw new Error("Deno is not available in this environment.");
			}
			const content = Deno.readTextFileSync(path);
			cache = JSON.parse(content);
			return cache;
		} catch (err) {
			if (err instanceof Deno.errors.NotFound) {
				throw new DecoupleError(`Failed to load JSON file (${path})`);
			}

			if (err instanceof SyntaxError) {
				throw new DecoupleError(
					"Unable to parse JSON file. Please check the file for syntax errors.",
				);
			}

			console.error(err);
			cache = {};
			return cache;
		}
	};
}

export function unstable_fromJsonFiles(paths: string[]) {
	return paths
		.map((path) => unstable_fromJsonFile(path))
		.reduce(
			(a, b) => {
				return () => {
					return { ...a(), ...b() };
				};
			},
			() => ({}),
		);
}

let Deno: any;

let global: any;

if (typeof (globalThis as any).Deno !== "undefined") {
	Deno = (globalThis as any).Deno;
} else if (typeof window !== "undefined" && typeof (window as any).Deno !== "undefined") {
	Deno = (window as any).Deno;
} else if (typeof global !== "undefined" && typeof (global as any).Deno !== "undefined") {
	Deno = (global as any).Deno;
}
