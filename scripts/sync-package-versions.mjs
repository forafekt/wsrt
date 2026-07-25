import fs from "node:fs";
import path from "node:path";
import { releaseVersion, workspaceRoot } from "./package-metadata.mjs";
import { privatePackages, publicPackages } from "./public-packages.mjs";

const expected = new Set([...publicPackages, ...privatePackages]);
const updated = [];

for (const directory of ["packages", "plugins", "runtimes", "libraries"])
	for (const entry of fs.readdirSync(path.join(workspaceRoot, directory), {
		withFileTypes: true,
	})) {
		if (!entry.isDirectory()) continue;
		const file = path.join(workspaceRoot, directory, entry.name, "package.json");
		if (!fs.existsSync(file)) continue;
		const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
		if (!expected.has(manifest.name)) continue;
		if (manifest.version === releaseVersion) continue;
		manifest.version = releaseVersion;
		fs.writeFileSync(file, `${JSON.stringify(manifest, null, "\t")}\n`);
		updated.push(manifest.name);
	}

console.log(
	updated.length
		? `Synchronized ${updated.length} package versions to ${releaseVersion}.`
		: `All WSRT package versions already match ${releaseVersion}.`,
);
