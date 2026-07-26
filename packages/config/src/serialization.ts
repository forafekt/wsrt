import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { WorkspaceDefinitionInput } from "./system.js";

export const configFormats = Object.freeze([
	"yaml",
	"yml",
	"json",
	"ts",
	"js",
	"mjs",
	"cjs",
	"mts",
	"cts",
] as const);

export type WsrtConfigFormat = (typeof configFormats)[number];

export function isConfigFormat(value: string): value is WsrtConfigFormat {
	return (configFormats as readonly string[]).includes(value.toLowerCase());
}

export function configFormatFromPath(file: string): WsrtConfigFormat | undefined {
	const extension = path.extname(file).slice(1).toLowerCase();
	return isConfigFormat(extension) ? extension : undefined;
}

export function defaultConfigFileName(format: WsrtConfigFormat): string {
	return `wsrt.${format}`;
}

export function deriveConfigDestination(source: string, format: WsrtConfigFormat): string {
	return `${source.slice(0, -path.extname(source).length)}.${format}`;
}

export function serializeConfig(
	config: WorkspaceDefinitionInput,
	options: { format: WsrtConfigFormat },
): string {
	assertSerializable(config, options.format);
	if (options.format === "yaml" || options.format === "yml")
		return stringifyYaml(config, { indent: 2, lineWidth: 0, nullStr: "" });
	const body = JSON.stringify(config, null, 2);
	if (options.format === "json") return `${body}\n`;
	if (options.format === "cjs") return `"use strict";\n\nmodule.exports = ${body};\n`;
	if (options.format === "cts") return `const config = ${body};\n\nexport = config;\n`;
	return `import { defineSystem } from "wsrt";\n\nexport default defineSystem(${body});\n`;
}

function assertSerializable(
	value: unknown,
	format: WsrtConfigFormat,
	configPath = "",
	ancestors = new Set<object>(),
): void {
	const fail = (reason: string): never => {
		throw new Error(
			`Cannot serialize configuration value at "${configPath || "<root>"}": ${reason} are not supported by ${format.toUpperCase()} output.`,
		);
	};
	if (value === undefined) fail("undefined values");
	if (typeof value === "function") fail("functions");
	if (typeof value === "symbol") fail("symbols");
	if (typeof value === "bigint") fail("bigint values");
	if (!value || typeof value !== "object") return;
	if (ancestors.has(value)) fail("circular references");
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null)
		fail("class and runtime object instances");
	ancestors.add(value);
	if (Array.isArray(value))
		value.forEach((item, index) => {
			assertSerializable(item, format, `${configPath}[${index}]`, ancestors);
		});
	else
		for (const [key, item] of Object.entries(value))
			assertSerializable(item, format, configPath ? `${configPath}.${key}` : key, ancestors);
	ancestors.delete(value);
}
