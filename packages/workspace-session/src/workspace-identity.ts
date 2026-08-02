import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const CONFIG_NAMES = [
	"wsrt.config.ts",
	"wsrt.config.js",
	"wsrt.config.mjs",
	"wsrt.yaml",
	"wsrt.yml",
	"wsrt.json",
];

export async function discoverWorkspaceRoot(input?: string, config?: string): Promise<string> {
	if (config) return canonical(path.dirname(path.resolve(input ?? process.cwd(), config)));
	let candidate = path.resolve(input ?? process.cwd());
	for (;;) {
		for (const name of CONFIG_NAMES)
			if (await exists(path.join(candidate, name))) return canonical(candidate);
		const parent = path.dirname(candidate);
		if (parent === candidate)
			throw Object.assign(new Error(`No WSRT configuration found from ${input ?? process.cwd()}`), {
				code: "workspace.not_found",
			});
		candidate = parent;
	}
}

export async function workspaceIdentity(
	root: string,
): Promise<{ root: string; workspaceId: string }> {
	const canonicalRoot = await canonical(root);
	const normalized = process.platform === "win32" ? canonicalRoot.toLowerCase() : canonicalRoot;
	return {
		root: canonicalRoot,
		workspaceId: crypto.createHash("sha256").update(normalized).digest("hex"),
	};
}

async function canonical(value: string): Promise<string> {
	return path.normalize(await fs.realpath(path.resolve(value)));
}

async function exists(file: string): Promise<boolean> {
	return fs.stat(file).then(
		(item) => item.isFile(),
		() => false,
	);
}
