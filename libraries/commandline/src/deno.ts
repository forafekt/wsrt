// Runtime details are kept in this tiny adapter so the parser remains portable.
const deno = (
	globalThis as {
		Deno?: {
			args: string[];
			build: { os: string; arch: string };
			version: { deno: string };
		};
	}
).Deno;

const nodeProcess = (
	globalThis as {
		process?: {
			argv: string[];
			platform: string;
			arch: string;
			versions: { node?: string };
		};
	}
).process;

/** Arguments in the same shape as Node's process.argv. */
export const processArgs = deno
	? ["deno", "cli", ...deno.args]
	: (nodeProcess?.argv ?? ["cli", "cli"]);

export const platformInfo = deno
	? `${deno.build.os}-${deno.build.arch} deno-${deno.version.deno}`
	: `${nodeProcess?.platform ?? "unknown"}-${nodeProcess?.arch ?? "unknown"} node-${nodeProcess?.versions.node ?? "unknown"}`;
