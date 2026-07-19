import { cursor as cursorBase } from "@wsrt/ansi-tools";

import { createKeyDecoder } from "../../core/utils/key.ts";

export * from "./key.ts";
export * from "./settings.ts";
export * from "./string.ts";

const encoder = new TextEncoder();
const isWindows = Deno.build.os === "windows";

export const CANCEL_SYMBOL = Symbol("prompts:cancel");

export function isCancel(value: unknown): value is symbol {
	return value === CANCEL_SYMBOL;
}

/* ANSI cursor helpers */
const cursor = {
	...cursorBase,
	// move: (dx: number, dy: number) =>
	//   `\x1b[${Math.abs(dy)}${dy < 0 ? "A" : "B"}\x1b[${Math.abs(dx)}${
	//     dx < 0 ? "D" : "C"
	//   }`,
};

export function setRawMode(value: boolean) {
	if (Deno.stdin.isTerminal()) {
		Deno.stdin.setRaw(value);
	}
}

interface BlockOptions {
	input?: typeof Deno.stdin;
	output?: typeof Deno.stdout;
	overwrite?: boolean;
	hideCursor?: boolean;
}

const decodeKey = createKeyDecoder();

export function block({
	input = Deno.stdin,
	output = Deno.stdout,
	overwrite = true,
	hideCursor = true,
}: BlockOptions = {}) {
	setRawMode(true);

	if (hideCursor) {
		output.writeSync(encoder.encode(cursor.hide));
	}

	let running = true;
	const decoder = new TextDecoder();

	async function listen() {
		const buffer = new Uint8Array(8);

		while (running) {
			const n = await input.read(buffer);
			if (!n) continue;

			const chunk = buffer.subarray(0, n);
			const str = decoder.decode(chunk);
			const key = decodeKey(str);

			if (!key) continue;

			if (key === "cancel") {
				if (hideCursor) output.writeSync(encoder.encode(cursor.show));
				Deno.exit(0);
			}

			if (!overwrite) continue;

			// only act on decoded keys
			if (key === "return") {
				output.writeSync(encoder.encode(cursor.move(0, -1)));
			}

			// const name = str === "\r"
			//   ? "return"
			//   : str === "\x03"
			//   ? "cancel"
			//   : undefined;

			// if (isActionKey([str, name, str], "cancel")) {
			//   if (hideCursor) output.writeSync(encoder.encode(cursor.show));
			//   Deno.exit(0);
			// }

			// if (!overwrite) continue;

			// const dx = name === "return" ? 0 : -1;
			// const dy = name === "return" ? -1 : 0;

			// const move = cursor.move(dx, dy);
			// output.writeSync(encoder.encode(move + cursor.clearLine));
		}
	}

	listen();

	return () => {
		running = false;

		if (hideCursor) {
			output.writeSync(encoder.encode(cursor.show));
		}

		// Avoid Windows raw-mode issues
		if (!isWindows) {
			setRawMode(false);
		}
	};
}

export const getColumns = (fallback = 80): number => {
	try {
		return Deno.consoleSize().columns;
	} catch {
		return fallback;
	}
};

export const getRows = (fallback = 20): number => {
	try {
		return Deno.consoleSize().rows;
	} catch {
		return fallback;
	}
};
