import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface WorkspaceConfigurationSource {
	readonly file: string;
	readonly hash: string;
}

export interface WorkspaceConfigurationRevision {
	readonly fingerprint: string;
	readonly loadedAt: string;
	readonly sources: readonly WorkspaceConfigurationSource[];
}

export class WorkspaceConfigurationTracker {
	private constructor(
		readonly loaded: WorkspaceConfigurationRevision,
		readonly sourceFiles: readonly string[],
	) {}
	static async create(
		sourceFile: string,
		effectiveDefinition: unknown,
	): Promise<WorkspaceConfigurationTracker> {
		const sourceFiles = await discoverSources(sourceFile);
		const loaded = await revision(sourceFiles, effectiveDefinition);
		return new WorkspaceConfigurationTracker(loaded, sourceFiles);
	}
	async inspect(effectiveDefinition: unknown): Promise<{
		revision: WorkspaceConfigurationRevision;
		stale: boolean;
		changedSources: readonly string[];
	}> {
		const currentFiles = await discoverSources(this.sourceFiles[0]);
		const current = await revision(currentFiles, effectiveDefinition);
		const previous = new Map(this.loaded.sources.map((item) => [item.file, item.hash]));
		const next = new Map(current.sources.map((item) => [item.file, item.hash]));
		const changedSources = [...new Set([...previous.keys(), ...next.keys()])].filter(
			(file) => previous.get(file) !== next.get(file),
		);
		return {
			revision: current,
			stale: current.fingerprint !== this.loaded.fingerprint,
			changedSources,
		};
	}
}

async function revision(
	files: readonly string[],
	effective: unknown,
): Promise<WorkspaceConfigurationRevision> {
	const sources = await Promise.all(
		[...files].sort().map(async (file) => ({
			file,
			hash: crypto
				.createHash("sha256")
				.update(await fs.readFile(file))
				.digest("hex"),
		})),
	);
	const fingerprint = crypto
		.createHash("sha256")
		.update(stable(effective))
		.update(stable(sources))
		.digest("hex");
	return { fingerprint, loadedAt: new Date().toISOString(), sources };
}

async function discoverSources(entry: string): Promise<string[]> {
	const seen = new Set<string>();
	async function visit(file: string): Promise<void> {
		const resolved = path.resolve(file);
		if (seen.has(resolved)) return;
		seen.add(resolved);
		const text = await fs.readFile(resolved, "utf8");
		for (const match of text.matchAll(
			/(?:import|export)\s+(?:[^"']*?\s+from\s+)?["'](\.[^"']+)["']/g,
		)) {
			const base = path.resolve(path.dirname(resolved), match[1]);
			const candidate = await resolveSource(base);
			if (candidate) await visit(candidate);
		}
	}
	await visit(entry);
	return [...seen];
}

async function resolveSource(base: string): Promise<string | undefined> {
	const sourceBase = /\.[cm]?js$/.test(base) ? base.replace(/\.[cm]?js$/, "") : base;
	for (const file of [
		base,
		...[".ts", ".mts", ".cts"].map((extension) => `${sourceBase}${extension}`),
		...[".ts", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json"].map(
			(extension) => `${base}${extension}`,
		),
	])
		if (
			await fs.stat(file).then(
				(value) => value.isFile(),
				() => false,
			)
		)
			return file;
	return undefined;
}

function stable(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.entries(value)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
			.join(",")}}`;
	return JSON.stringify(value) ?? "null";
}
