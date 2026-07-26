import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { transform } from "esbuild";
import { parse as parseYaml } from "yaml";
import {
	type NormalizedSystemDefinition,
	normalizeSystemDefinition,
	type SystemDiagnostic,
	type WorkspaceDefinitionInput,
} from "./system.js";

export const configFileNames = Object.freeze([
	"wsrt.config.ts",
	"wsrt.config.mts",
	"wsrt.config.cts",
	"wsrt.config.js",
	"wsrt.config.mjs",
	"wsrt.config.cjs",
	"wsrt.ts",
	"wsrt.mts",
	"wsrt.cts",
	"wsrt.js",
	"wsrt.mjs",
	"wsrt.cjs",
	"wsrt.json",
	"wsrt.jsonc",
	"wsrt.yaml",
	"wsrt.yml",
] as const);

export function discoverConfigFile(root: string, explicit?: string): string | undefined {
	if (explicit) {
		const file = path.resolve(root, explicit);
		return fs.existsSync(file) ? file : undefined;
	}
	return configFileNames.map((name) => path.join(root, name)).find((file) => fs.existsSync(file));
}

export async function loadSystemDefinition(
	root = process.cwd(),
	explicit?: string,
): Promise<{
	definition?: NormalizedSystemDefinition;
	input?: WorkspaceDefinitionInput;
	diagnostics: SystemDiagnostic[];
	file?: string;
}> {
	const base = path.resolve(root),
		file = discoverConfigFile(base, explicit);
	if (!file)
		return {
			diagnostics: [
				{
					code: "config.not_found",
					severity: "error",
					message: "No WSRT configuration file found",
					source: { file: base, path: "" },
				},
			],
		};
	try {
		const input = await read(file);
		const result = normalizeSystemDefinition(input, { root: base, file });
		return { ...result, input: result.definition ? input : undefined, file };
	} catch (cause) {
		return {
			file,
			diagnostics: [
				{
					code: "config.invalid",
					severity: "error",
					message: cause instanceof Error ? cause.message : String(cause),
					source: { file, path: "" },
				},
			],
		};
	}
}

async function read(file: string): Promise<WorkspaceDefinitionInput> {
	if (/\.ya?ml$/.test(file))
		return parseYaml(fs.readFileSync(file, "utf8")) as WorkspaceDefinitionInput;
	if (file.endsWith(".json")) return JSON.parse(fs.readFileSync(file, "utf8"));
	if (file.endsWith(".jsonc"))
		return JSON.parse(fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""));
	if (file.endsWith(".cjs")) return value(createRequire(import.meta.url)(file));
	if (/\.(?:ts|mts|cts)$/.test(file)) {
		const commonjs = file.endsWith(".cts");
		const output = await transform(fs.readFileSync(file, "utf8"), {
			loader: "ts",
			format: commonjs ? "cjs" : "esm",
			platform: "node",
			target: "node20",
		});
		const temporary = path.join(
			path.dirname(file),
			`.wsrt-${process.pid}-${Date.now()}.${commonjs ? "cjs" : "mjs"}`,
		);
		fs.writeFileSync(temporary, output.code);
		try {
			return value(
				commonjs
					? createRequire(import.meta.url)(temporary)
					: await import(pathToFileURL(temporary).href),
			);
		} finally {
			fs.rmSync(temporary, { force: true });
		}
	}
	return value(await import(pathToFileURL(file).href));
}

function value(input: unknown): WorkspaceDefinitionInput {
	const candidate =
		input && typeof input === "object" && "default" in input
			? (input as { default: unknown }).default
			: input;
	const resolved = typeof candidate === "function" ? candidate() : candidate;
	if (!resolved || typeof resolved !== "object" || Array.isArray(resolved))
		throw new Error("Configuration must export an object");
	return resolved as WorkspaceDefinitionInput;
}
