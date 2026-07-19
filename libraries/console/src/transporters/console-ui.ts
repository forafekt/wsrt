import * as ansi from "@wsrt/ansi-tools";
import type { ConsoleLogEntry, ConsoleLogTransport } from "../types.js";

type ColorFunction = (input: string | number | null | undefined) => string;

export type ConsoleUiTransportOptions = {
	showTimestamp?: boolean;
	showContext?: boolean;
	showErrors?: boolean;
	maxDepth?: number;
	maxWidth?: number;
	omitUndefined?: boolean;
	compactEmptyCollections?: boolean;
	tableMinRows?: number;
};

const DEFAULT_OPTIONS: Required<ConsoleUiTransportOptions> = {
	showTimestamp: true,
	showContext: true,
	showErrors: true,
	maxDepth: 8,
	maxWidth: 140,
	omitUndefined: true,
	compactEmptyCollections: true,
	tableMinRows: 2,
};

export class ConsoleUiTransport implements ConsoleLogTransport {
	private readonly options: Required<ConsoleUiTransportOptions>;

	constructor(options: ConsoleUiTransportOptions = {}) {
		this.options = {
			...DEFAULT_OPTIONS,
			...options,
		};

		this.log = this.log.bind(this);
	}

	log(entry: ConsoleLogEntry): void {
		const output = this.renderEntry(entry);
		const write = entry.level === "error" || entry.level === "fatal" ? console.error : console.log;

		write(output);
	}

	private renderEntry(entry: ConsoleLogEntry): string {
		const lines: string[] = [this.renderHeader(entry)];

		if (this.options.showContext && entry.context && Object.keys(entry.context).length > 0) {
			lines.push("");
			lines.push(
				renderStructuredValue(entry.context, {
					maxDepth: this.options.maxDepth,
					maxWidth: this.getWidth(),
					omitUndefined: this.options.omitUndefined,
					compactEmptyCollections: this.options.compactEmptyCollections,
					tableMinRows: this.options.tableMinRows,
				}),
			);
		}

		if (this.options.showErrors && entry.error) {
			lines.push("");
			lines.push(ansi.colors.bold(ansi.colors.red("Error")));
			lines.push(
				indentBlock(
					renderError(entry.error, {
						maxDepth: this.options.maxDepth,
						maxWidth: this.getWidth(),
						omitUndefined: this.options.omitUndefined,
						compactEmptyCollections: this.options.compactEmptyCollections,
						tableMinRows: this.options.tableMinRows,
					}),
					2,
				),
			);
		}

		return lines.join("\n");
	}

	private renderHeader(entry: ConsoleLogEntry): string {
		const parts: string[] = [];

		if (this.options.showTimestamp) {
			parts.push(ansi.colors.gray(formatTimestamp(entry.timestamp)));
		}

		parts.push(renderLevel(entry.level));
		parts.push(renderMessage(entry.level, String(entry.message)));

		return parts.join("  ");
	}

	private getWidth(): number {
		const terminalWidth =
			typeof process !== "undefined" && typeof process.stdout?.columns === "number"
				? process.stdout.columns
				: this.options.maxWidth;

		return Math.max(60, Math.min(terminalWidth, this.options.maxWidth));
	}
}

type RenderOptions = {
	maxDepth: number;
	maxWidth: number;
	omitUndefined: boolean;
	compactEmptyCollections: boolean;
	tableMinRows: number;
};

function renderStructuredValue(value: unknown, options: RenderOptions): string {
	if (!isRecord(value)) {
		return formatScalar(value);
	}

	const sections: string[] = [];

	for (const [key, child] of filterEntries(value, options)) {
		sections.push(renderNamedSection(humanizeKey(key), child, options, 0, new WeakSet<object>()));
	}

	return sections.join("\n\n");
}

function renderNamedSection(
	title: string,
	value: unknown,
	options: RenderOptions,
	depth: number,
	seen: WeakSet<object>,
): string {
	if (isScalar(value)) {
		return `${ansi.colors.bold(title.padEnd(13))} ${formatScalar(value)}`;
	}

	if (isEmptyCollection(value)) {
		return `${ansi.colors.bold(title.padEnd(13))} ${ansi.colors.gray(emptyCollectionLabel(value))}`;
	}

	if (Array.isArray(value)) {
		return renderArraySection(title, value, options, depth, seen);
	}

	if (isRecord(value)) {
		if (seen.has(value)) {
			return `${ansi.colors.bold(title.padEnd(13))} ${ansi.colors.gray("[Circular]")}`;
		}

		seen.add(value);

		const entries = filterEntries(value, options);

		if (isFlatRecord(entries)) {
			return renderKeyValueSection(title, entries);
		}

		const lines = [renderSectionHeading(title)];

		for (const [key, child] of entries) {
			lines.push(
				indentBlock(renderNamedSection(humanizeKey(key), child, options, depth + 1, seen), 2),
			);
		}

		return lines.join("\n");
	}

	return `${ansi.colors.bold(title.padEnd(13))} ${formatScalar(value)}`;
}

function renderArraySection(
	title: string,
	values: unknown[],
	options: RenderOptions,
	depth: number,
	seen: WeakSet<object>,
): string {
	if (values.length === 0) {
		return `${ansi.colors.bold(title.padEnd(13))} ${ansi.colors.gray("none")}`;
	}

	if (values.every(isScalar)) {
		const lines = [
			renderSectionHeading(title, values.length),
			...values.map((value) => `  ${formatScalar(value)}`),
		];

		return lines.join("\n");
	}

	if (values.length >= options.tableMinRows && values.every(isRecord)) {
		const records = values as Record<string, unknown>[];
		const columns = selectTableColumns(records, options);

		if (columns.length > 0) {
			return [
				renderSectionHeading(title, values.length),
				indentBlock(renderTable(records, columns, options.maxWidth - 2), 2),
			].join("\n");
		}
	}

	const lines = [renderSectionHeading(title, values.length)];

	values.forEach((value, index) => {
		const itemTitle = getItemTitle(value, index);

		lines.push(indentBlock(renderNamedSection(itemTitle, value, options, depth + 1, seen), 2));
	});

	return lines.join("\n");
}

function renderKeyValueSection(title: string, entries: Array<[string, unknown]>): string {
	const keyWidth = Math.max(...entries.map(([key]) => humanizeKey(key).length));

	const lines = [renderSectionHeading(title)];

	for (const [key, value] of entries) {
		lines.push(`  ${ansi.colors.gray(humanizeKey(key).padEnd(keyWidth))}  ${formatScalar(value)}`);
	}

	return lines.join("\n");
}

function renderSectionHeading(title: string, count?: number): string {
	const suffix = count === undefined ? "" : ` ${ansi.colors.gray(`· ${count}`)}`;

	return `${ansi.colors.bold(title)}${suffix}`;
}

function renderTable(
	records: Record<string, unknown>[],
	columns: string[],
	maxWidth: number,
): string {
	const rows = records.map((record) => columns.map((column) => formatTableValue(record[column])));

	const widths = columns.map((column, columnIndex) => {
		const contentWidth = Math.max(
			column.length,
			...rows.map((row) => visibleLength(row[columnIndex] ?? "")),
		);

		return Math.min(contentWidth, 28);
	});

	shrinkColumnsToWidth(widths, columns.length - 1, maxWidth);

	const header = columns
		.map((column, index) =>
			ansi.colors.gray(truncate(column.toUpperCase(), widths[index]).padEnd(widths[index])),
		)
		.join("  ");

	const body = rows.map((row) =>
		row.map((cell, index) => padAnsi(truncateAnsi(cell, widths[index]), widths[index])).join("  "),
	);

	return [header, ...body].join("\n");
}

function selectTableColumns(records: Record<string, unknown>[], options: RenderOptions): string[] {
	const frequencies = new Map<string, number>();

	for (const record of records) {
		for (const [key, value] of filterEntries(record, options)) {
			if (isScalar(value)) {
				frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
			}
		}
	}

	const preferredOrder = [
		"id",
		"name",
		"kind",
		"type",
		"state",
		"status",
		"health",
		"runtime",
		"pid",
		"restartCount",
	];

	const available = [...frequencies.entries()]
		.filter(([, frequency]) => frequency === records.length)
		.map(([key]) => key);

	return [
		...preferredOrder.filter((key) => available.includes(key)),
		...available.filter((key) => !preferredOrder.includes(key)),
	].slice(0, 8);
}

function renderError(error: unknown, options: RenderOptions): string {
	if (!(error instanceof Error)) {
		return renderStructuredValue(error, options);
	}

	const lines = [`${ansi.colors.bold(error.name)}: ${ansi.colors.red(error.message)}`];

	if (error.stack) {
		const stackLines = error.stack.split("\n");

		// The first stack line normally repeats name and message.
		for (const line of stackLines.slice(1)) {
			lines.push(ansi.colors.gray(line.trimStart()));
		}
	}

	if (error.cause !== undefined) {
		lines.push("");
		lines.push(ansi.colors.bold("Cause"));
		lines.push(indentBlock(renderError(error.cause, options), 2));
	}

	const customEntries = Object.entries(error).filter(
		([key]) => key !== "name" && key !== "message" && key !== "stack" && key !== "cause",
	);

	if (customEntries.length > 0) {
		lines.push("");
		lines.push(renderKeyValueSection("Details", customEntries));
	}

	return lines.join("\n");
}

function filterEntries(
	value: Record<string, unknown>,
	options: RenderOptions,
): Array<[string, unknown]> {
	return Object.entries(value).filter(([, child]) => {
		if (options.omitUndefined && child === undefined) {
			return false;
		}

		return true;
	});
}

function isFlatRecord(entries: Array<[string, unknown]>): boolean {
	return entries.every(([, value]) => isScalar(value));
}

function isScalar(value: unknown): boolean {
	return (
		value === null ||
		value === undefined ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "bigint" ||
		typeof value === "boolean" ||
		typeof value === "symbol" ||
		typeof value === "function" ||
		value instanceof Date
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		!(value instanceof Date) &&
		!(value instanceof Map) &&
		!(value instanceof Set)
	);
}

function isEmptyCollection(value: unknown): boolean {
	if (Array.isArray(value)) {
		return value.length === 0;
	}

	if (value instanceof Map || value instanceof Set) {
		return value.size === 0;
	}

	if (isRecord(value)) {
		return Object.keys(value).length === 0;
	}

	return false;
}

function emptyCollectionLabel(value: unknown): string {
	if (Array.isArray(value)) {
		return "none";
	}

	if (value instanceof Map) {
		return "empty map";
	}

	if (value instanceof Set) {
		return "empty set";
	}

	return "empty";
}

function getItemTitle(value: unknown, index: number): string {
	if (isRecord(value)) {
		const candidate = value.id ?? value.name ?? value.key ?? value.type;

		if (typeof candidate === "string" || typeof candidate === "number") {
			return String(candidate);
		}
	}

	return `#${index + 1}`;
}

function formatTableValue(value: unknown): string {
	if (value === undefined || value === null) {
		return ansi.colors.gray("—");
	}

	if (typeof value === "boolean") {
		return value ? ansi.colors.green("yes") : ansi.colors.gray("no");
	}

	return formatScalar(value);
}

function formatScalar(value: unknown): string {
	if (value === null) {
		return ansi.colors.magenta("null");
	}

	if (value === undefined) {
		return ansi.colors.gray("—");
	}

	if (typeof value === "string") {
		return value;
	}

	if (typeof value === "number") {
		return ansi.colors.cyan(value);
	}

	if (typeof value === "bigint") {
		return ansi.colors.cyan(`${value}n`);
	}

	if (typeof value === "boolean") {
		return value ? ansi.colors.green("true") : ansi.colors.gray("false");
	}

	if (typeof value === "symbol") {
		return ansi.colors.magenta(String(value));
	}

	if (typeof value === "function") {
		return ansi.colors.gray(`[Function ${value.name || "anonymous"}]`);
	}

	if (value instanceof Date) {
		return ansi.colors.cyan(value.toISOString());
	}

	if (Array.isArray(value)) {
		return value.length === 0
			? ansi.colors.gray("none")
			: ansi.colors.gray(`${value.length} items`);
	}

	if (value instanceof Map) {
		return ansi.colors.gray(`${value.size} entries`);
	}

	if (value instanceof Set) {
		return ansi.colors.gray(`${value.size} items`);
	}

	return String(value);
}

function renderLevel(level: string): string {
	const normalized = level.toLowerCase();
	const label = normalized.toUpperCase().padEnd(5);

	const colors: Record<string, ColorFunction> = {
		trace: ansi.colors.gray,
		debug: ansi.colors.cyan,
		info: ansi.colors.green,
		warn: ansi.colors.yellow,
		error: ansi.colors.red,
		fatal: ansi.colors.magenta,
	};

	return (colors[normalized] ?? ansi.colors.gray)(label);
}

function renderMessage(level: string, message: string): string {
	const colors: Record<string, ColorFunction> = {
		trace: ansi.colors.gray,
		debug: ansi.colors.cyan,
		info: ansi.colors.green,
		warn: ansi.colors.yellow,
		error: ansi.colors.red,
		fatal: ansi.colors.magenta,
	};

	return (colors[level] ?? String)(message);
}

function formatTimestamp(timestamp: ConsoleLogEntry["timestamp"]): string {
	const date = new Date(timestamp);

	if (Number.isNaN(date.getTime())) {
		return String(timestamp);
	}

	return `${[
		String(date.getHours()).padStart(2, "0"),
		String(date.getMinutes()).padStart(2, "0"),
		String(date.getSeconds()).padStart(2, "0"),
	].join(":")}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

function humanizeKey(key: string): string {
	return key
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.replace(/^./, (character) => character.toUpperCase());
}

function indentBlock(value: string, spaces: number): string {
	const prefix = " ".repeat(spaces);

	return value
		.split("\n")
		.map((line) => `${prefix}${line}`)
		.join("\n");
}

function shrinkColumnsToWidth(widths: number[], preferredColumn: number, maxWidth: number): void {
	const separatorsWidth = Math.max(0, widths.length - 1) * 2;

	while (widths.reduce((sum, width) => sum + width, 0) + separatorsWidth > maxWidth) {
		let largestIndex = preferredColumn;

		for (let index = 0; index < widths.length; index += 1) {
			if (widths[index] > widths[largestIndex] && widths[index] > 8) {
				largestIndex = index;
			}
		}

		if (widths[largestIndex] <= 8) {
			break;
		}

		widths[largestIndex] -= 1;
	}
}

function truncate(value: string, width: number): string {
	if (value.length <= width) {
		return value;
	}

	if (width <= 1) {
		return "…";
	}

	return `${value.slice(0, width - 1)}…`;
}

function truncateAnsi(value: string, width: number): string {
	if (visibleLength(value) <= width) {
		return value;
	}

	// This intentionally strips styling when truncation is needed.
	return truncate(stripAnsi(value), width);
}

function padAnsi(value: string, width: number): string {
	return value + " ".repeat(Math.max(0, width - visibleLength(value)));
}

function visibleLength(value: string): number {
	return stripAnsi(value).length;
}

function stripAnsi(value: string): string {
	return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}
