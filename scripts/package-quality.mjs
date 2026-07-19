import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { privatePackages, publicPackages, releaseVersion } from "./public-packages.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignored = new Set(["node_modules", ".git", ".release"]);
const manifests = [];
function visit(directory) {
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		if (ignored.has(entry.name)) continue;
		const target = path.join(directory, entry.name);
		if (entry.isDirectory()) visit(target);
		else if (entry.name === "package.json") {
			const value = JSON.parse(fs.readFileSync(target, "utf8"));
			if (value.name === "wsrt" || value.name?.startsWith("@wsrt/"))
				manifests.push({
					directory: path.dirname(target),
					file: target,
					value,
				});
		}
	}
}
visit(root);

const errors = [];
const names = new Set();
for (const { directory, value } of manifests) {
	if (names.has(value.name)) errors.push(`duplicate package name: ${value.name}`);
	names.add(value.name);
	const intendedPublic = publicPackages.includes(value.name);
	if (intendedPublic === !!value.private)
		errors.push(`${value.name}: private flag disagrees with publication catalog`);
	if (!intendedPublic && !privatePackages.includes(value.name))
		errors.push(`${value.name}: missing from publication catalog`);
	if (!intendedPublic) continue;
	for (const field of [
		"description",
		"license",
		"repository",
		"bugs",
		"homepage",
		"keywords",
		"files",
		"exports",
		"types",
		"engines",
		"publishConfig",
	])
		if (!value[field] || (Array.isArray(value[field]) && value[field].length === 0))
			errors.push(`${value.name}: missing ${field}`);
	if (value.version !== releaseVersion)
		errors.push(`${value.name}: expected fixed version ${releaseVersion}`);
	if (!fs.existsSync(path.join(directory, "README.md")))
		errors.push(`${value.name}: missing README.md`);
	if (!value.files.includes("dist") || !value.files.includes("README.md"))
		errors.push(`${value.name}: files must include dist and README.md`);
	if (value.publishConfig?.access !== "public")
		errors.push(`${value.name}: publishConfig.access must be public`);
	if (value.exports?.["./*"]) errors.push(`${value.name}: wildcard export is not allowed`);
	for (const kind of Object.keys({
		...value.dependencies,
		...value.optionalDependencies,
		...value.peerDependencies,
	})) {
		if (kind.startsWith("@wsrt/") && !publicPackages.includes(kind))
			errors.push(`${value.name}: runtime dependency ${kind} is not public`);
	}
	const dist = path.join(directory, "dist");
	for (const target of Object.values(value.exports ?? {}).flatMap((entry) =>
		typeof entry === "string" ? [entry] : Object.values(entry),
	)) {
		if (
			typeof target === "string" &&
			target.startsWith("./dist/") &&
			!fs.existsSync(path.join(directory, target))
		)
			errors.push(`${value.name}: export target missing: ${target}`);
	}
	if (fs.existsSync(dist)) {
		for (const built of fs.readdirSync(dist, { recursive: true })) {
			if (!String(built).endsWith(".js")) continue;
			const contents = fs.readFileSync(path.join(dist, built), "utf8");
			if (contents.includes(`${root}/`))
				errors.push(`${value.name}: development path leaked into dist/${built}`);
			if (/from ["'](?:\.\.\/)*src\//.test(contents))
				errors.push(`${value.name}: source import leaked into dist/${built}`);
		}
	}
	if (value.bin?.wsrt) {
		const executable = path.join(directory, value.bin.wsrt);
		if (fs.existsSync(executable)) {
			if (!fs.readFileSync(executable, "utf8").startsWith("#!/usr/bin/env node"))
				errors.push(`${value.name}: CLI shebang missing`);
			if (!(fs.statSync(executable).mode & 0o111))
				errors.push(`${value.name}: CLI is not executable`);
		}
	}
}
for (const expected of [...publicPackages, ...privatePackages])
	if (!names.has(expected)) errors.push(`${expected}: catalog entry has no manifest`);
if (!fs.existsSync(path.join(root, "LICENSE")))
	errors.push("repository license decision unresolved: root LICENSE is missing");
if (errors.length) {
	console.error(errors.map((error) => `- ${error}`).join("\n"));
	process.exitCode = 1;
} else console.log(`Package quality checks passed for ${publicPackages.length} public packages.`);
