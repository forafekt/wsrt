import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { releaseVersion } from "./public-packages.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.env.WSRT_RELEASE_CONFIRM !== releaseVersion)
	throw new Error(
		`Refusing to publish. Set WSRT_RELEASE_CONFIRM=${releaseVersion} after reviewing docs/RELEASING.md.`,
	);

if (!fs.existsSync(path.join(root, "LICENSE")))
	throw new Error("Refusing to publish without a confirmed root LICENSE.");

execFileSync("pnpm", ["release:pack"], { cwd: root, stdio: "inherit" });

const tag = releaseVersion.includes("-") ? "next" : "latest";

for (const tarball of fs
	.readdirSync(path.join(root, ".release", "tarballs"))
	.filter((file) => file.endsWith(".tgz"))
	.sort())
	execFileSync(
		"npm",
		[
			"publish",
			path.join(root, ".release", "tarballs", tarball),
			"--access",
			"public",
			"--provenance",
			"--tag",
			tag,
		],
		{ cwd: root, stdio: "inherit" },
	);
