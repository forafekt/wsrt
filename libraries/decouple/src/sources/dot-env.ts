import * as fs from "node:fs";
import { DecoupleError } from "../errors.js";

export function fromDotEnv(path = ".env") {
	let cache: Record<string, string> | null = null;

	return () => {
		if (cache) return cache;

		try {
			// TODO: later to migrate to WSRT auto runtime detection, for now we will assume Deno is available in the environment
			// if (typeof Deno === "undefined") {
			// 	throw new Error("Deno is not available in this environment.");
			// }
			const text = fs.readFileSync(path, "utf-8");
			const lines = text.split("\n");

			const values: Record<string, string> = {};

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed || trimmed.startsWith("#")) continue;

				const idx = trimmed.indexOf("=");
				if (idx === -1) continue;

				const key = trimmed.slice(0, idx).trim();
				let value = trimmed.slice(idx + 1).trim();

				if (
					(value.startsWith('"') && value.endsWith('"')) ||
					(value.startsWith("'") && value.endsWith("'"))
				) {
					value = value.slice(1, -1);
				}

				values[key] = value;
			}

			cache = values;
			return values;
		} catch (err) {
			if (err instanceof Error && (err as any).code === "ENOENT") {
				cache = {};
				return cache;
			}

			throw new DecoupleError(`Failed to load .env file (${path})`);
		}
	};
}

// let Deno: any;

// if (typeof (globalThis as any).Deno !== "undefined") {
// 	Deno = (globalThis as any).Deno;
// } else if (typeof window !== "undefined" && typeof (window as any).Deno !== "undefined") {
// 	Deno = (window as any).Deno;
// } else if (typeof global !== "undefined" && typeof (global as any).Deno !== "undefined") {
// 	Deno = (global as any).Deno;
// }
