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

const names = [
	"wsrt.config.ts",
	"wsrt.config.js",
	"wsrt.config.mjs",
	"wsrt.config.cjs",
	"wsrt.json",
	"wsrt.jsonc",
	"wsrt.yaml",
	"wsrt.yml",
];
export function discoverConfigFile(
	root: string,
	explicit?: string,
): string | undefined {
	if (explicit) {
		const file = path.resolve(root, explicit);
		return fs.existsSync(file) ? file : undefined;
	}
	return names
		.map((name) => path.join(root, name))
		.find((file) => fs.existsSync(file));
}
export async function loadSystemDefinition(
	root = process.cwd(),
	explicit?: string,
): Promise<{
	definition?: NormalizedSystemDefinition;
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
		return { ...result, file };
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
		return JSON.parse(
			fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""),
		);
	if (file.endsWith(".cjs")) return value(createRequire(import.meta.url)(file));
	if (file.endsWith(".ts")) {
		const output = await transform(fs.readFileSync(file, "utf8"), {
			loader: "ts",
			format: "esm",
			platform: "node",
			target: "node20",
		});
		const temporary = path.join(
			path.dirname(file),
			`.wsrt-${process.pid}-${Date.now()}.mjs`,
		);
		fs.writeFileSync(temporary, output.code);
		try {
			return value(await import(pathToFileURL(temporary).href));
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
