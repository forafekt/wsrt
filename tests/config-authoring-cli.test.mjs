import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
	configFormats,
	loadSystemDefinition,
	serializeConfig,
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
			for (const key of [
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
				assert.ok(key in loaded.input, `${format} template omitted ${key}`);
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
