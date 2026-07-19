import { colors } from "@wsrt/ansi-tools";
import { S_BAR, S_ERROR, S_INFO, S_STEP_SUBMIT, S_SUCCESS, S_WARN } from "./common.ts";
import type { LogMessageOptions } from "./log.ts";

const prefix = `${colors.gray(S_BAR)}  `;

// TODO (43081j): this currently doesn't support custom `output` writables
// because we rely on `columns` existing (i.e. `process.stdout.columns).
//
// If we want to support `output` being passed in, we will need to use
// a condition like `if (output insance Writable)` to check if it has columns
export const stream = {
	message: async (
		iterable: Iterable<string> | AsyncIterable<string>,
		{ symbol = colors.gray(S_BAR) }: LogMessageOptions = {},
	) => {
		Deno.stdout.write(new TextEncoder().encode(`${colors.gray(S_BAR)}\n${symbol}  `));
		let lineWidth = 3;
		for await (let chunk of iterable) {
			chunk = chunk.replace(/\n/g, `\n${prefix}`);
			if (chunk.includes("\n")) {
				lineWidth = 3 + strip(chunk.slice(chunk.lastIndexOf("\n"))).length;
			}
			const chunkLen = strip(chunk).length;
			if (lineWidth + chunkLen < Deno.consoleSize().columns) {
				lineWidth += chunkLen;
				Deno.stdout.write(new TextEncoder().encode(chunk));
			} else {
				Deno.stdout.write(new TextEncoder().encode(`\n${prefix}${chunk.trimStart()}`));
				lineWidth = 3 + strip(chunk.trimStart()).length;
			}
		}
		Deno.stdout.write(new TextEncoder().encode("\n"));
	},
	info: (iterable: Iterable<string> | AsyncIterable<string>) => {
		return stream.message(iterable, { symbol: colors.blue(S_INFO) });
	},
	success: (iterable: Iterable<string> | AsyncIterable<string>) => {
		return stream.message(iterable, { symbol: colors.green(S_SUCCESS) });
	},
	step: (iterable: Iterable<string> | AsyncIterable<string>) => {
		return stream.message(iterable, { symbol: colors.green(S_STEP_SUBMIT) });
	},
	warn: (iterable: Iterable<string> | AsyncIterable<string>) => {
		return stream.message(iterable, { symbol: colors.yellow(S_WARN) });
	},
	/** alias for `log.warn()`. */
	warning: (iterable: Iterable<string> | AsyncIterable<string>) => {
		return stream.warn(iterable);
	},
	error: (iterable: Iterable<string> | AsyncIterable<string>) => {
		return stream.message(iterable, { symbol: colors.red(S_ERROR) });
	},
};

function strip(str: string): string {
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}
