export function findCursor<T extends { disabled?: boolean }>(
	cursor: number,
	delta: number,
	options: T[],
	visited = 0,
): number {
	if (visited >= options.length) return cursor;

	const max = Math.max(options.length - 1, 0);
	const next = cursor + delta < 0 ? max : cursor + delta > max ? 0 : cursor + delta;

	if (options[next]?.disabled) {
		return findCursor(next, delta, options, visited + 1);
	}

	return next;
}

export const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

export function visibleLength(str: string) {
	return str.replace(ANSI_REGEX, "").length;
}

export function wrapAnsi(
	text: string,
	width: number,
	opts: { hard?: boolean; trim?: boolean } = {},
) {
	const hard = opts.hard ?? false;
	const trim = opts.trim ?? false;

	const words = text.split(/(\s+)/);
	const lines: string[] = [];

	let line = "";
	let lineLength = 0;

	for (const token of words) {
		const tokenLen = visibleLength(token);

		// fits in current line
		if (lineLength + tokenLen <= width) {
			line += token;
			lineLength += tokenLen;
			continue;
		}

		// push line and reset
		if (line.length > 0) {
			lines.push(trim ? line.trimEnd() : line);
			line = "";
			lineLength = 0;
		}

		// hard wrap long token
		if (hard && tokenLen > width) {
			let chunk = token;

			while (visibleLength(chunk) > width) {
				const slice = chunk.slice(0, width);
				lines.push(slice);
				chunk = chunk.slice(width);
			}

			line = chunk;
			lineLength = visibleLength(chunk);
			continue;
		}

		line = token;
		lineLength = tokenLen;
	}

	if (line.length) {
		lines.push(trim ? line.trimEnd() : line);
	}

	return lines.join("\n");
}

export function wrapTextWithPrefix(
	_textOutput: unknown,
	text: string,
	prefix: string,
	startPrefix: string = prefix,
	columns: number = getConsoleSize().columns,
): string {
	const wrapped = wrapAnsi(text, columns - prefix.length, {
		hard: true,
		trim: false,
	});

	return wrapped
		.split("\n")
		.map((line, i) => `${i === 0 ? startPrefix : prefix}${line}`)
		.join("\n");
}

function getConsoleSize() {
	let Deno: any;
	if (typeof (globalThis as any).Deno !== "undefined") {
		Deno = (globalThis as any).Deno;
	} else if (typeof window !== "undefined" && typeof (window as any).Deno !== "undefined") {
		Deno = (window as any).Deno;
	} else if (typeof global !== "undefined" && typeof (global as any).Deno !== "undefined") {
		Deno = (global as any).Deno;
	}
	if (typeof Deno !== "undefined") {
		return Deno.consoleSize;
	} else if (typeof process !== "undefined") {
		return process.stdout;
	}
}
