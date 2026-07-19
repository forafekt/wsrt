import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packageCatalog, publicPackages, releaseVersion } from "./public-packages.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const warning = "This package is part of WSRT, which is under active early development.";
const errors = [];
const names = new Set();
const catalogByDirectory = new Map(packageCatalog.map((record) => [record.directory, record]));
const catalogByName = new Map(packageCatalog.map((record) => [record.name, record]));
const manifests = [];

function visit(directory) {
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		if (["node_modules", ".git", ".release", "target"].includes(entry.name)) continue;
		const target = path.join(directory, entry.name);
		if (entry.isDirectory()) visit(target);
		else if (entry.name === "package.json") {
			const packageDirectory = path.dirname(target);
			manifests.push({
				directory: packageDirectory,
				relativeDirectory: path.relative(root, packageDirectory) || ".",
				value: JSON.parse(fs.readFileSync(target, "utf8")),
			});
		}
	}
}
visit(root);

for (const { directory, relativeDirectory, value } of manifests) {
	const record = catalogByDirectory.get(relativeDirectory);
	if (!record) {
		errors.push(`${relativeDirectory}: package manifest has no classification`);
		continue;
	}
	if (record.name !== value.name)
		errors.push(`${relativeDirectory}: catalog expects ${record.name}, found ${value.name}`);
	if (names.has(value.name)) errors.push(`duplicate package name: ${value.name}`);
	names.add(value.name);
	const isPublic = record.classification.startsWith("public-");
	if (isPublic === Boolean(value.private))
		errors.push(`${value.name}: private flag disagrees with ${record.classification}`);
	if (!isPublic && value.private !== true)
		errors.push(`${value.name}: non-public package must be private`);
	if (!isPublic) continue;

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
	if (record.classification === "public-fixed" && value.version !== releaseVersion)
		errors.push(`${value.name}: expected fixed version ${releaseVersion}`);
	if (value.type !== "module") errors.push(`${value.name}: public packages must declare ESM type`);
	if (value.engines?.node !== ">=22.0.0")
		errors.push(`${value.name}: engines.node must be >=22.0.0`);
	if (value.publishConfig?.access !== "public")
		errors.push(`${value.name}: publish access must be public`);
	if (value.publishConfig?.provenance !== true)
		errors.push(`${value.name}: provenance must be enabled`);
	if (!value.files?.includes("dist") || !value.files?.includes("README.md"))
		errors.push(`${value.name}: files must include dist and README.md`);
	if (value.exports?.["./*"]) errors.push(`${value.name}: wildcard export is not allowed`);
	const readme = path.join(directory, "README.md");
	if (!fs.existsSync(readme)) errors.push(`${value.name}: missing README.md`);
	else if (!fs.readFileSync(readme, "utf8").slice(0, 1200).includes(warning))
		errors.push(`${value.name}: README lacks the standard early-development warning near the top`);

	for (const [dependency, range] of Object.entries({
		...value.dependencies,
		...value.optionalDependencies,
		...value.peerDependencies,
	})) {
		if (range === "*" || range === "latest")
			errors.push(`${value.name}: prohibited range for ${dependency}: ${range}`);
		if (
			(dependency === "wsrt" || dependency.startsWith("@wsrt/")) &&
			!publicPackages.includes(dependency)
		)
			errors.push(`${value.name}: runtime dependency ${dependency} is not public`);
	}
	for (const [exportName, entry] of Object.entries(value.exports ?? {})) {
		for (const target of typeof entry === "string" ? [entry] : Object.values(entry)) {
			if (typeof target !== "string" || !target.startsWith("./dist/")) continue;
			if (!fs.existsSync(path.join(directory, target)))
				errors.push(`${value.name}: ${exportName} target missing: ${target}`);
		}
	}
	for (const target of [value.main, value.module, value.types, ...Object.values(value.bin ?? {})])
		if (target && !fs.existsSync(path.join(directory, target)))
			errors.push(`${value.name}: manifest entry point missing: ${target}`);
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

for (const record of packageCatalog) {
	if (!names.has(record.name)) errors.push(`${record.name}: catalog entry has no manifest`);
}
for (const { value, relativeDirectory } of manifests) {
	if (!catalogByName.has(value.name))
		errors.push(`${relativeDirectory}: ${value.name} missing from catalog`);
}

const rootLicense = path.join(root, "LICENSE");
if (!fs.existsSync(rootLicense)) {
	errors.push(
		"publication blocker: repository owner must select a license and add canonical root LICENSE",
	);
} else {
	const canonical = fs.readFileSync(rootLicense);
	for (const record of packageCatalog.filter(({ classification }) =>
		classification.startsWith("public-"),
	)) {
		const local = path.join(root, record.directory, "LICENSE");
		if (fs.existsSync(local) && !fs.readFileSync(local).equals(canonical))
			errors.push(`${record.name}: package LICENSE differs from canonical root LICENSE`);
	}
}

if (errors.length) {
	console.error(errors.map((error) => `- ${error}`).join("\n"));
	process.exitCode = 1;
} else
	console.log(
		`Package policy passed for ${manifests.length} classified manifests and ${publicPackages.length} public packages.`,
	);
