import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const workspaceManifest = JSON.parse(
	fs.readFileSync(path.join(workspaceRoot, "package.json"), "utf8"),
);

export const releaseVersion = workspaceManifest.version;

if (typeof releaseVersion !== "string" || releaseVersion.length === 0)
	throw new Error("The root package.json must declare a non-empty version.");
