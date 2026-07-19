import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { NodeRuntimeProvider, WsrtControlPlane, createControlPlane, defineSystem } from "wsrt";

const manifest = JSON.parse(fs.readFileSync("packages/wsrt/package.json", "utf8"));

test("wsrt exposes the deliberate public distribution API", () => {
	assert.equal(typeof defineSystem, "function");
	assert.equal(typeof createControlPlane, "function");
	assert.equal(typeof WsrtControlPlane, "function");
	assert.equal(new NodeRuntimeProvider().id, "node");
	assert.equal(manifest.exports["."].import, "./dist/index.js");
	assert.equal(manifest.exports["."].types, "./dist/index.d.ts");
});

test("wsrt binary delegates to the official CLI package", () => {
	assert.equal(manifest.bin.wsrt, "./dist/cli.js");
	const executable = fs.readFileSync("packages/wsrt/dist/cli.js", "utf8");
	assert.match(executable, /^#!\/usr\/bin\/env node/);
	assert.match(executable, /from ["']@wsrt\/cli["']/);
});

test("wsrt does not couple optional plugins", () => {
	const dependencies = Object.keys(manifest.dependencies ?? {});
	assert.equal(
		dependencies.some((name) => name.startsWith("@wsrt/plugin-")),
		false,
	);
	const source = fs.readFileSync("packages/wsrt/src/index.ts", "utf8");
	assert.doesNotMatch(source, /@wsrt\/plugin-/);
});
