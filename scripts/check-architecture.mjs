import fs from "node:fs";
import path from "node:path";

const manifests = [];
for (const root of ["packages", "plugins", "runtimes", "libraries"]) {
	if (!fs.existsSync(root)) continue;
	for (const entry of fs.readdirSync(root)) {
		const file = path.join(root, entry, "package.json");
		if (fs.existsSync(file)) manifests.push(file);
	}
}
const packages = new Map(
	manifests.map((file) => {
		const value = JSON.parse(fs.readFileSync(file, "utf8"));
		return [value.name, { file, value }];
	}),
);
const edges = [];
for (const [name, { file, value }] of packages) {
	for (const dependency of Object.keys({
		...value.dependencies,
		...value.optionalDependencies,
	})) {
		if (packages.has(dependency)) edges.push([name, dependency, file]);
	}
}
const visiting = new Set(),
	done = new Set(),
	stack = [];
function visit(name) {
	if (visiting.has(name))
		throw new Error(`Workspace dependency cycle: ${[...stack, name].join(" -> ")}`);
	if (done.has(name)) return;
	visiting.add(name);
	stack.push(name);
	for (const [from, to] of edges) if (from === name) visit(to);
	stack.pop();
	visiting.delete(name);
	done.add(name);
}
for (const name of packages.keys()) visit(name);
const files = [];
for (const root of ["packages", "plugins", "runtimes", "tests", "examples"]) walk(root);
const banned = ["@wsrt/types", "@wsrt/services", "@wsrt/reports", "@wsrt/core"];
const violations = files.flatMap((file) =>
	banned
		.filter((name) => fs.readFileSync(file, "utf8").includes(name))
		.map((name) => `${file}: ${name}`),
);
for (const [name, { file, value }] of packages) {
	if (!file.startsWith(`packages${path.sep}`)) continue;
	for (const dependency of Object.keys({
		...value.dependencies,
		...value.optionalDependencies,
		...value.peerDependencies,
	}))
		if (dependency.startsWith("@wsrt/plugin-"))
			violations.push(`${file}: core package ${name} depends on concrete plugin ${dependency}`);
}
for (const file of files.filter((item) => item.startsWith(`packages${path.sep}`))) {
	const source = fs.readFileSync(file, "utf8"),
		matches = source.match(/@wsrt\/plugin-[a-z0-9-]+/g) ?? [];
	for (const dependency of new Set(matches))
		violations.push(`${file}: core source references concrete plugin ${dependency}`);
}
if (violations.length) throw new Error(`Architecture violations:\n${violations.join("\n")}`);
console.log(
	`Architecture valid: ${packages.size} packages, ${edges.length} workspace edges, no cycles or obsolete imports`,
);
function walk(root) {
	if (!fs.existsSync(root)) return;
	for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
		if (["node_modules", "dist"].includes(entry.name)) continue;
		const file = path.join(root, entry.name);
		if (entry.isDirectory()) walk(file);
		else if (/\.(ts|js|mjs|json)$/.test(entry.name)) files.push(file);
	}
}
