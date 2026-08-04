import { readFile } from "node:fs/promises";
import { basename, extname, normalize, posix } from "node:path";
import type { normalizeWorkbenchOptions } from "../plugin.js";

const assetRoot = new URL("../ui/", import.meta.url);
const contentTypes = new Map([
	[".css", "text/css; charset=utf-8"],
	[".js", "text/javascript; charset=utf-8"],
	[".map", "application/json; charset=utf-8"],
	[".svg", "image/svg+xml"],
	[".png", "image/png"],
	[".webp", "image/webp"],
]);

export async function renderWorkbenchIndex(
	options: ReturnType<typeof normalizeWorkbenchOptions>,
): Promise<string> {
	const template = await readFile(new URL("index.html", assetRoot), "utf8");
	return template
		.replaceAll("%WSRT_TITLE%", escapeHtml(options.title))
		.replaceAll("%WSRT_BASE_PATH%", escapeHtml(options.basePath))
		.replaceAll("%WSRT_MUTATIONS%", String(options.mutations));
}

export async function readWorkbenchAsset(relativePath: string) {
	const safe = safeAssetPath(relativePath);
	if (!safe) return undefined;
	try {
		return {
			body: await readFile(new URL(safe, assetRoot)),
			contentType: contentTypes.get(extname(safe)) ?? "application/octet-stream",
		};
	} catch {
		return undefined;
	}
}

function safeAssetPath(relativePath: string) {
	const withoutPrefix = relativePath.replace(/^\/assets\//, "assets/");
	const normalized = normalize(withoutPrefix).replaceAll("\\", "/");
	if (!normalized.startsWith("assets/") || normalized.includes("../")) return undefined;
	if (basename(normalized).startsWith(".")) return undefined;
	return posix.normalize(normalized);
}

function escapeHtml(value: string) {
	return value.replace(
		/[&"<>]/g,
		(character) =>
			({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[character] ?? character,
	);
}
