import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publicPackageRecords, publicPackages } from "./public-packages.mjs";
import { readTarball } from "./tarball.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalLicense = path.join(root, "LICENSE");
if (!fs.existsSync(canonicalLicense))
	throw new Error(
		"Cannot pack: repository owner must select a license and add canonical root LICENSE.",
	);
const output = path.join(root, ".release", "tarballs");
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const { name, directory } of publicPackageRecords) {
	const packageLicense = path.join(root, directory, "LICENSE");
	const previous = fs.existsSync(packageLicense) ? fs.readFileSync(packageLicense) : undefined;
	try {
		fs.copyFileSync(canonicalLicense, packageLicense);
		execFileSync("pnpm", ["--filter", name, "pack", "--pack-destination", output], {
			cwd: root,
			stdio: "inherit",
		});
	} finally {
		if (previous) fs.writeFileSync(packageLicense, previous);
		else fs.rmSync(packageLicense, { force: true });
	}
}
const tarballs = fs
	.readdirSync(output)
	.filter((file) => file.endsWith(".tgz"))
	.sort();
if (tarballs.length !== publicPackages.length)
	throw new Error(`Expected ${publicPackages.length} tarballs, found ${tarballs.length}`);
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
			throw new Error(`${tarball} contains forbidden content matching ${forbidden}`);
	const manifest = JSON.parse(entries.get("package/package.json")?.toString("utf8") ?? "null");
	if (!manifest) throw new Error(`${tarball} has no package/package.json`);
	for (const required of ["package/README.md", "package/LICENSE"])
		if (!entries.has(required)) throw new Error(`${tarball} is missing ${required}`);
	if (!entries.get("package/LICENSE").equals(fs.readFileSync(canonicalLicense)))
		throw new Error(`${tarball} contains a non-canonical LICENSE`);
	const serialized = JSON.stringify(manifest);
	if (serialized.includes("workspace:"))
		throw new Error(`${tarball} contains an unresolved workspace range`);
	for (const target of [
		manifest.main,
		manifest.module,
		manifest.types,
		...Object.values(manifest.bin ?? {}),
	])
		if (target && !entries.has(`package/${target.replace(/^\.\//, "")}`))
			throw new Error(`${tarball} is missing manifest target ${target}`);
	for (const entry of Object.values(manifest.exports ?? {}))
		for (const target of typeof entry === "string" ? [entry] : Object.values(entry))
			if (
				typeof target === "string" &&
				target.startsWith("./") &&
				!entries.has(`package/${target.slice(2)}`)
			)
				throw new Error(`${tarball} is missing export target ${target}`);
}
console.log(`Packed and inspected ${tarballs.length} tarballs in ${path.relative(root, output)}.`);
