import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
	checkWsrtConfigJsonSchema,
	configFormats,
	createNullishSystemTemplate,
	generateWsrtConfigJsonSchema,
	loadSystemDefinition,
	normalizeSystemDefinition,
	serializeConfig,
	serializeWsrtConfigJsonSchema,
	WSRT_CONFIG_SCHEMA_URL,
} from "../packages/config/dist/index.js";

const executable = path.resolve("packages/cli/dist/index.js");

test("init generates every supported format from the canonical template", async () => {
	const root = await temporaryDirectory();
	try {
		for (const format of configFormats) {
			const result = await cli("init", "--root", root, "--format", format);
			assert.equal(result.code, 0, result.stderr);
			const file = path.join(root, `wsrt.${format}`);
			const loaded = await loadSystemDefinition(root, file);
			assert.ok(loaded.definition, loaded.diagnostics.map((item) => item.message).join("\n"));
			const contents = await readFile(file, "utf8");
			const optionalSections = [
				"workspace",
				"runtimes",
				"applications",
				"services",
				"tasks",
				"artifacts",
				"environments",
				"plugins",
				"persistence",
			];
			if (format === "yaml" || format === "yml") {
				for (const key of optionalSections) {
					assert.match(contents, new RegExp(`^${key}:$`, "m"));
					assert.equal(loaded.input[key], null);
				}
				assert.doesNotMatch(contents, /: null$/m);
				assert.match(
					contents,
					new RegExp(
						`^# yaml-language-server: \\$schema=${WSRT_CONFIG_SCHEMA_URL.replaceAll(".", "\\.")}$`,
						"m",
					),
				);
				assert.equal(loaded.input.$schema, WSRT_CONFIG_SCHEMA_URL);
			} else if (format === "json") {
				for (const key of optionalSections) assert.equal(loaded.input[key], null);
				assert.match(contents, /"workspace": null/);
			} else {
				for (const key of optionalSections)
					assert.equal(key in loaded.input, false, `${format} template populated ${key}`);
				assert.doesNotMatch(contents, /\bnull\b/);
			}
		}
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test("init infers nested output format, protects files, detects conflicts, and supports force", async () => {
	const root = await temporaryDirectory();
	try {
		assert.equal((await cli("init", "--root", root, "-o", "config/wsrt.json")).code, 0);
		assert.match(await readFile(path.join(root, "config/wsrt.json"), "utf8"), /"schemaVersion"/);
		const protectedResult = await cli("init", "--root", root, "-o", "config/wsrt.json");
		assert.equal(protectedResult.code, 1);
		assert.match(protectedResult.stderr, /--force/);
		assert.equal((await cli("init", "--root", root, "-o", "config/wsrt.json", "--force")).code, 0);
		const conflict = await cli("init", "--root", root, "--format", "yaml", "--output", "wsrt.json");
		assert.equal(conflict.code, 1);
		assert.match(conflict.stderr, /conflicts/);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test("config convert discovers, validates, derives destinations, and protects output", async () => {
	const root = await temporaryDirectory();
	try {
		await writeFile(path.join(root, "wsrt.yml"), 'schemaVersion: "1"\nname: conversion\n');
		assert.equal((await cli("config", "convert", "--root", root, "--to", "json")).code, 0);
		assert.equal(
			JSON.parse(await readFile(path.join(root, "wsrt.json"), "utf8")).name,
			"conversion",
		);
		const protectedResult = await cli(
			"config",
			"convert",
			"--root",
			root,
			"wsrt.yml",
			"--to",
			"json",
		);
		assert.equal(protectedResult.code, 1);
		assert.match(protectedResult.stderr, /--force/);
		assert.equal(
			(
				await cli(
					"config",
					"convert",
					"--root",
					root,
					"--from",
					"wsrt.json",
					"--output",
					"generated/wsrt.mjs",
				)
			).code,
			0,
		);
		assert.ok((await loadSystemDefinition(root, "generated/wsrt.mjs")).definition);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test("config convert resolves TypeScript and JavaScript before writing static formats", async () => {
	const root = await temporaryDirectory();
	try {
		await writeFile(
			path.join(root, "dynamic.config.ts"),
			'import { defineSystem } from "wsrt";\nexport default defineSystem({ name: "ts-" + (1 + 1) });\n',
		);
		const typescript = await cli(
			"config",
			"convert",
			"--root",
			root,
			"dynamic.config.ts",
			"--to",
			"yaml",
		);
		assert.equal(typescript.code, 0, typescript.stderr);
		assert.match(await readFile(path.join(root, "dynamic.config.yaml"), "utf8"), /name: ts-2/);
		assert.match(typescript.stdout, /resolved from executable configuration/);

		await writeFile(
			path.join(root, "dynamic.mjs"),
			'export default () => ({ schemaVersion: "1", name: "javascript" });\n',
		);
		const javascript = await cli(
			"config",
			"convert",
			"--root",
			root,
			"dynamic.mjs",
			"--output",
			"dynamic.json",
		);
		assert.equal(javascript.code, 0, javascript.stderr);
		assert.equal(
			JSON.parse(await readFile(path.join(root, "dynamic.json"), "utf8")).name,
			"javascript",
		);

		const jsonToYaml = await cli(
			"config",
			"convert",
			"--root",
			root,
			"dynamic.json",
			"--output",
			"roundtrip.yml",
		);
		assert.equal(jsonToYaml.code, 0, jsonToYaml.stderr);
		assert.ok((await loadSystemDefinition(root, "roundtrip.yml")).definition);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test("conversion rejects invalid, same-file, unsupported, and non-serializable values", async () => {
	const root = await temporaryDirectory();
	try {
		await writeFile(path.join(root, "wsrt.yaml"), "services: {}\n");
		assert.match(
			(await cli("config", "convert", "--root", root, "--to", "json")).stderr,
			/System name is required/,
		);
		await writeFile(path.join(root, "wsrt.json"), '{"schemaVersion":"1","name":"valid"}\n');
		assert.match(
			(await cli("config", "convert", "--root", root, "wsrt.json", "--output", "wsrt.json")).stderr,
			/same file/,
		);
		assert.match(
			(await cli("config", "convert", "--root", root, "wsrt.json", "--to", "toml")).stderr,
			/supported format/,
		);
		assert.throws(
			() =>
				serializeConfig(
					{ name: "bad", services: { api: { command: () => undefined } } },
					{ format: "yaml" },
				),
			/services\.api\.command.*functions/,
		);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test("nullish templates normalize like omitted sections and retain required values", () => {
	const root = process.cwd();
	const nullish = normalizeSystemDefinition(createNullishSystemTemplate("nullish"), {
		root,
		file: path.join(root, "nullish.yaml"),
	});
	const omitted = normalizeSystemDefinition(
		{ schemaVersion: "1", name: "nullish" },
		{
			root,
			file: path.join(root, "omitted.yaml"),
		},
	);
	assert.ok(nullish.definition);
	assert.ok(omitted.definition);
	for (const key of ["runtimes", "executables", "artifacts", "environments", "plugins"])
		assert.deepEqual(nullish.definition[key], omitted.definition[key]);
	assert.equal(
		normalizeSystemDefinition(
			{ schemaVersion: "1", name: null, services: null },
			{ root, file: "invalid.yaml" },
		).definition,
		undefined,
	);
	const explicit = normalizeSystemDefinition(
		{ schemaVersion: "1", name: "nullish", persistence: null },
		{ root, file: path.join(root, "nullish.yaml") },
	);
	assert.deepEqual(explicit.definition, nullish.definition);
	assert.equal(
		normalizeSystemDefinition(
			{
				schemaVersion: "1",
				name: "invalid",
				runtimes: { node: { provider: null } },
			},
			{ root, file: "invalid-required.yaml" },
		).definition,
		undefined,
	);
});

test("YAML serialization consistently uses implicit nulls while JSON remains explicit", () => {
	const input = { schemaVersion: "1", name: "converted", persistence: null };
	assert.equal(
		serializeConfig(input, { format: "yaml" }),
		'schemaVersion: "1"\nname: converted\npersistence:\n',
	);
	assert.match(serializeConfig(input, { format: "json" }), /"persistence": null/);
});

test("config validate supports every loader, JSON diagnostics, cycles, and no execution", async () => {
	const root = await temporaryDirectory();
	try {
		for (const format of configFormats) {
			const output = `config.${format}`;
			assert.equal((await cli("init", "--root", root, "--format", format, "-o", output)).code, 0);
			const validated = await cli("config", "validate", "--root", root, output);
			assert.equal(validated.code, 0, `${format}: ${validated.stderr}\n${validated.stdout}`);
		}
		await writeFile(
			path.join(root, "invalid.yaml"),
			"name: invalid\nservices:\n  api:\n    dependsOn: [web]\n  web:\n    dependsOn: [api]\n",
		);
		const invalid = await cli("config", "validate", "--root", root, "invalid.yaml", "--json");
		assert.equal(invalid.code, 1);
		const report = JSON.parse(invalid.stdout);
		assert.equal(report.valid, false);
		assert.ok(report.errors.some((error) => error.code === "graph.cycle"));

		const marker = path.join(root, "started");
		await writeFile(
			path.join(root, "safe.mjs"),
			`export default { name: "safe", services: { api: { command: ${JSON.stringify(
				`node -e "require('node:fs').writeFileSync('${marker}', 'started')"`,
			)} } } };\n`,
		);
		assert.equal((await cli("config", "validate", "--root", root, "safe.mjs")).code, 0);
		await assert.rejects(readFile(marker), /ENOENT/);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test("config test resolves and disposes providers, plans safely, and reports missing providers", async () => {
	const root = await temporaryDirectory();
	try {
		const disposed = path.join(root, "disposed");
		const started = path.join(root, "started");
		await writeFile(
			path.join(root, "plugin.mjs"),
			`import fs from "node:fs"; export default { id: "test-plugin", version: "1.0.0", contributions: { runtimes: [{ id: "custom", create() { fs.writeFileSync(${JSON.stringify(started)}, "started"); } }] }, dispose() { fs.writeFileSync(${JSON.stringify(disposed)}, "disposed"); } };\n`,
		);
		await writeFile(
			path.join(root, "wsrt.yaml"),
			`name: tested\nplugins: [./plugin.mjs]\nruntimes:\n  custom:\n    provider: custom\nservices:\n  api:\n    runtime: custom\n    root: .\n`,
		);
		const result = await cli("config", "test", "--root", root, "--plan", "--json");
		assert.equal(result.code, 0, result.stderr);
		const report = JSON.parse(result.stdout);
		assert.equal(report.valid, true);
		assert.deepEqual(report.startupPlan, [["service:api"]]);
		assert.equal(await readFile(disposed, "utf8"), "disposed");
		await assert.rejects(readFile(started), /ENOENT/);

		await writeFile(
			path.join(root, "missing.yaml"),
			"name: missing\nruntimes:\n  custom:\n    provider: unavailable\nservices:\n  api:\n    runtime: custom\n",
		);
		const missing = await cli("config", "test", "--root", root, "missing.yaml", "--json");
		assert.equal(missing.code, 1);
		assert.ok(
			JSON.parse(missing.stdout).errors.some((error) => error.code === "runtime.provider_missing"),
		);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test("schema generation is deterministic, current, public-only, and exportable", async () => {
	const first = serializeWsrtConfigJsonSchema(generateWsrtConfigJsonSchema());
	const second = serializeWsrtConfigJsonSchema(generateWsrtConfigJsonSchema());
	assert.equal(first, second);
	assert.equal(
		checkWsrtConfigJsonSchema(await readFile("packages/config/schema/wsrt.schema.json", "utf8")).ok,
		true,
	);
	assert.equal(checkWsrtConfigJsonSchema("{}\n").ok, false);
	const schema = JSON.parse(first);
	for (const key of [
		"$schema",
		"schemaVersion",
		"name",
		"workspace",
		"runtimes",
		"applications",
		"services",
		"tasks",
		"artifacts",
		"environments",
		"plugins",
		"persistence",
	])
		assert.ok(key in schema.properties);
	assert.equal("executables" in schema.properties, false);
	assert.deepEqual(schema.properties.services.anyOf.at(-1), { type: "null" });
	assert.equal(schema.$id, WSRT_CONFIG_SCHEMA_URL);

	const root = await temporaryDirectory();
	try {
		const exported = await cli(
			"config",
			"schema",
			"--root",
			root,
			"--output",
			".wsrt/wsrt.schema.json",
		);
		assert.equal(exported.code, 0, exported.stderr);
		assert.equal(await readFile(path.join(root, ".wsrt/wsrt.schema.json"), "utf8"), first);
		assert.equal((await cli("config", "schema", "--check")).code, 0);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

async function temporaryDirectory() {
	return mkdtemp(path.join(process.cwd(), ".wsrt-config-test-"));
}

function cli(...arguments_) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [executable, ...arguments_], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.on("error", reject);
		child.on("close", (code) => resolve({ code, stdout, stderr }));
	});
}
