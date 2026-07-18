import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publicPackages } from "./public-packages.mjs";
import { readTarball } from "./tarball.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, ".release", "tarballs");
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const packageName of publicPackages) {
	execFileSync(
		"pnpm",
		["--filter", packageName, "pack", "--pack-destination", output],
		{ cwd: root, stdio: "inherit" },
	);
}
const tarballs = fs
	.readdirSync(output)
	.filter((file) => file.endsWith(".tgz"))
	.sort();
if (tarballs.length !== publicPackages.length)
	throw new Error(
		`Expected ${publicPackages.length} tarballs, found ${tarballs.length}`,
	);
for (const tarball of tarballs) {
	const entries = readTarball(path.join(output, tarball));
	const listing = [...entries.keys()].join("\n");
	for (const forbidden of [
		/node_modules/,
		/coverage/,
		/(^|\/)tests?\//,
		/\.env(?:\.|$)/,
		/target\//,
		/\.log$/,
	])
		if (forbidden.test(listing))
			throw new Error(
				`${tarball} contains forbidden content matching ${forbidden}`,
			);
	const manifest = JSON.parse(
		entries.get("package/package.json")?.toString("utf8") ?? "null",
	);
	if (!manifest) throw new Error(`${tarball} has no package/package.json`);
	const serialized = JSON.stringify(manifest);
	if (serialized.includes("workspace:"))
		throw new Error(`${tarball} contains an unresolved workspace range`);
}
console.log(
	`Packed and inspected ${tarballs.length} tarballs in ${path.relative(root, output)}.`,
);
