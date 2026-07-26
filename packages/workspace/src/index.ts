import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export type WorkspaceDiagnostic = {
	code: string;
	severity: "info" | "warning" | "error";
	message: string;
	file?: string;
	package?: string;
	detail?: Readonly<Record<string, unknown>>;
};

export type WorkspaceFilter = {
	include?: readonly string[];
	exclude?: readonly string[];
	test?: (value: WorkspacePackage, target?: WorkspacePackage) => boolean;
};

export type WorkspaceResolveOptions = {
	root: string;
	include?: readonly string[];
	exclude?: readonly string[];
	sourceEntries?: readonly string[];
	aliases?: boolean;
	dependencies?: boolean;
};

export type WorkspacePackage = {
	name: string;
	root: string;
	manifestFile: string;
	manifest: Record<string, unknown>;
	private: boolean;
	publishable: boolean;
	source?: string;
	aliases: readonly string[];
	declaredDependencies: Readonly<Record<string, string>>;
	internalDependencies: readonly string[];
	inferredDependencies: readonly string[];
};

export type WorkspaceEdge = {
	from: string;
	to: string;
	type: "declared" | "inferred";
};

export type ResolvedWorkspace = {
	root: string;
	patterns: readonly string[];
	packages: readonly WorkspacePackage[];
	aliases: Readonly<Record<string, string>>;
	edges: readonly WorkspaceEdge[];
	diagnostics: readonly WorkspaceDiagnostic[];
};

export type ProjectionOptions = {
	tsconfig?: { files?: WorkspaceFilter; dependencies?: WorkspaceFilter } | false;
	manifests?:
		| {
				files?: WorkspaceFilter;
				dependencies?: WorkspaceFilter;
				section?: "dependencies" | "devDependencies" | "peerDependencies";
				version?: string;
				removeStale?: boolean;
		  }
		| false;
};

export type WorkspaceProjection = {
	file: string;
	kind: "tsconfig" | "manifest";
	current: string;
	next: string;
	changed: boolean;
	diagnostics: readonly WorkspaceDiagnostic[];
};

const defaultSources = ["src/index.ts", "src/index.tsx", "src/index.js", "src/index.jsx"];

const dependencySections = [
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"optionalDependencies",
] as const;

export async function resolveWorkspace(
	options: WorkspaceResolveOptions,
): Promise<ResolvedWorkspace> {
	const root = path.resolve(options.root);
	const diagnostics: WorkspaceDiagnostic[] = [];
	const patterns = await workspacePatterns(root, diagnostics);
	const files = await packageFiles(root, patterns, options.include, options.exclude);
	const entries: WorkspacePackage[] = [];
	const names = new Map<string, WorkspacePackage>();
	for (const manifestFile of files) {
		let manifest: Record<string, unknown>;
		try {
			manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
		} catch (cause) {
			diagnostics.push({
				code: "workspace.manifest_invalid",
				severity: "error",
				message: `Invalid manifest: ${relative(root, manifestFile)}`,
				file: manifestFile,
				detail: { cause: String(cause) },
			});
			continue;
		}
		const name = typeof manifest.name === "string" ? manifest.name : undefined;
		if (!name) {
			diagnostics.push({
				code: "workspace.package_name_missing",
				severity: "warning",
				message: `Package has no name: ${relative(root, manifestFile)}`,
				file: manifestFile,
			});
			continue;
		}
		const packageRoot = path.dirname(manifestFile);
		const source = await sourceEntry(
			packageRoot,
			manifest,
			options.sourceEntries ?? defaultSources,
		);
		const item: WorkspacePackage = {
			name,
			root: packageRoot,
			manifestFile,
			manifest,
			private: manifest.private === true,
			publishable: manifest.private !== true,
			source,
			aliases: Object.freeze(packageAliases(name, manifest)),
			declaredDependencies: Object.freeze(dependencies(manifest)),
			internalDependencies: Object.freeze([]),
			inferredDependencies: Object.freeze([]),
		};
		const duplicate = names.get(name);
		if (duplicate)
			diagnostics.push({
				code: "workspace.package_name_duplicate",
				severity: "error",
				message: `Duplicate package name "${name}" in ${relative(root, duplicate.root)} and ${relative(root, packageRoot)}`,
				file: manifestFile,
				package: name,
			});
		else names.set(name, item);
		entries.push(item);
	}
	const aliases: Record<string, string> = {};
	for (const item of entries)
		if (item.source && options.aliases !== false)
			for (const alias of item.aliases) {
				if (aliases[alias] && aliases[alias] !== item.source)
					diagnostics.push({
						code: "workspace.alias_conflict",
						severity: "error",
						message: `Alias "${alias}" resolves to multiple sources`,
						package: item.name,
					});
				else aliases[alias] = item.source;
				for (const [subpath, source] of await exportedSourceEntries(
					item.root,
					item.manifest.exports,
				))
					aliases[`${alias}/${subpath}`] = source;
			}
	const edges: WorkspaceEdge[] = [];
	for (const item of entries) {
		const declared = Object.keys(item.declaredDependencies)
			.filter((name) => names.has(name))
			.sort();
		const inferred = options.dependencies === false ? [] : await inferDependencies(item, names);
		item.internalDependencies = Object.freeze(declared);
		item.inferredDependencies = Object.freeze(inferred.filter((name) => !declared.includes(name)));
		for (const to of declared) edges.push({ from: item.name, to, type: "declared" });
		for (const to of item.inferredDependencies)
			edges.push({ from: item.name, to, type: "inferred" });
	}
	return Object.freeze({
		root,
		patterns: Object.freeze(patterns),
		packages: Object.freeze(entries.sort((a, b) => a.name.localeCompare(b.name))),
		aliases: Object.freeze(Object.fromEntries(Object.entries(aliases).sort())),
		edges: Object.freeze(edges.sort(edgeSort)),
		diagnostics: Object.freeze(diagnostics),
	});
}

export async function projectWorkspace(
	model: ResolvedWorkspace,
	options: ProjectionOptions = {},
): Promise<readonly WorkspaceProjection[]> {
	const result: WorkspaceProjection[] = [];
	if (options.tsconfig !== false)
		for (const target of model.packages) {
			if (!matches(target, options.tsconfig?.files)) continue;
			const file = path.join(target.root, "tsconfig.json");
			const current = await readOptional(file);
			if (current === undefined) continue;
			const json = parseJsonc(current);
			const generated: Record<string, string[]> = {};
			for (const dependency of model.packages)
				if (
					dependency.source &&
					dependency.name !== target.name &&
					matches(dependency, options.tsconfig?.dependencies, target)
				)
					generated[dependency.name] = [
						slash(path.relative(target.root, dependency.source)) || ".",
					];
			const compilerOptions = record(json.compilerOptions);
			const paths = record(compilerOptions.paths);
			const next = {
				...json,
				compilerOptions: {
					...compilerOptions,
					paths: { ...paths, ...generated },
				},
			};
			result.push(
				projection(
					file,
					"tsconfig",
					current,
					stableJson(next),
					generatedDiagnostics(file, paths, generated, "path"),
				),
			);
		}
	if (options.manifests !== false)
		for (const target of model.packages) {
			if (!matches(target, options.manifests?.files)) continue;
			const current = await fs.readFile(target.manifestFile, "utf8");
			const json = JSON.parse(current) as Record<string, unknown>;
			const section = options.manifests?.section ?? "dependencies";
			const existing = record(json[section]);
			const generated: Record<string, string> = {};
			for (const name of [...target.internalDependencies, ...target.inferredDependencies].sort()) {
				const dependency = model.packages.find((item) => item.name === name);
				if (dependency && matches(dependency, options.manifests?.dependencies, target))
					generated[name] = options.manifests?.version ?? "workspace:*";
			}
			const merged = { ...existing, ...generated };
			if (options.manifests?.removeStale)
				for (const name of Object.keys(merged))
					if (model.packages.some((item) => item.name === name) && !generated[name])
						delete merged[name];
			const next = {
				...json,
				[section]: Object.fromEntries(Object.entries(merged).sort()),
			};
			result.push(
				projection(
					target.manifestFile,
					"manifest",
					current,
					stableJson(next),
					generatedDiagnostics(target.manifestFile, existing, generated, "dependency"),
				),
			);
		}
	return Object.freeze(result.sort((a, b) => a.file.localeCompare(b.file)));
}

export async function syncWorkspace(
	projections: readonly WorkspaceProjection[],
	mode: "write" | "check" = "write",
): Promise<{ changed: readonly WorkspaceProjection[]; ok: boolean }> {
	const changed = projections.filter((item) => item.changed);
	if (mode === "write") for (const item of changed) await fs.writeFile(item.file, item.next);
	return {
		changed: Object.freeze(changed),
		ok: changed.length === 0 || mode === "write",
	};
}

async function workspacePatterns(
	root: string,
	diagnostics: WorkspaceDiagnostic[],
): Promise<string[]> {
	const pnpmFile = path.join(root, "pnpm-workspace.yaml");
	try {
		const value = parseYaml(await fs.readFile(pnpmFile, "utf8")) as {
			packages?: unknown;
		};
		if (Array.isArray(value?.packages))
			return value.packages.filter((item): item is string => typeof item === "string");
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code !== "ENOENT")
			diagnostics.push({
				code: "workspace.config_invalid",
				severity: "error",
				message: "Invalid pnpm-workspace.yaml",
				file: pnpmFile,
			});
	}
	try {
		const manifest = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
		const workspaces = Array.isArray(manifest.workspaces)
			? manifest.workspaces
			: manifest.workspaces?.packages;
		if (Array.isArray(workspaces))
			return workspaces.filter((item: unknown): item is string => typeof item === "string");
	} catch {}
	return ["packages/*", "apps/*", "plugins/*", "libraries/*", "runtimes/*"];
}

async function packageFiles(
	root: string,
	patterns: readonly string[],
	include?: readonly string[],
	exclude?: readonly string[],
): Promise<string[]> {
	const all: string[] = [];
	await walk(root, async (file) => {
		if (path.basename(file) === "package.json" && path.dirname(file) !== root) all.push(file);
	});
	return all
		.filter((file) => {
			const dir = slash(path.relative(root, path.dirname(file)));
			return (
				patterns.some((pattern) => glob(dir, pattern)) &&
				(!include?.length || include.some((pattern) => glob(dir, pattern))) &&
				!exclude?.some((pattern) => glob(dir, pattern))
			);
		})
		.sort();
}

async function walk(dir: string, visit: (file: string) => Promise<void>): Promise<void> {
	for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
		if (["node_modules", ".git", "dist"].includes(entry.name)) continue;
		const file = path.join(dir, entry.name);
		if (entry.isDirectory()) await walk(file, visit);
		else await visit(file);
	}
}

async function sourceEntry(
	root: string,
	manifest: Record<string, unknown>,
	preferred: readonly string[],
): Promise<string | undefined> {
	const candidates = [
		stringValue(manifest.source),
		exportSource(manifest.exports, true),
		...preferred,
		exportSource(manifest.exports, false),
		stringValue(manifest.module),
		stringValue(manifest.main),
	].filter((item): item is string => !!item);
	for (const candidate of candidates) {
		const file = path.resolve(root, candidate);
		try {
			if ((await fs.stat(file)).isFile()) return file;
		} catch {}
	}
}

function exportSource(value: unknown, development: boolean): string | undefined {
	const entry = record(value)["."];
	if (typeof entry === "string") return development ? undefined : entry;
	const map = record(entry);
	const candidates = development ? [map.source, map.development] : [map.import, map.default];
	return candidates.find((item): item is string => typeof item === "string");
}

function packageAliases(name: string, manifest: Record<string, unknown>): string[] {
	const aliases = Array.isArray(manifest.wsrtAliases)
		? manifest.wsrtAliases.filter((item): item is string => typeof item === "string")
		: [];
	return [...new Set([name, ...aliases])].sort();
}

async function exportedSourceEntries(
	root: string,
	value: unknown,
): Promise<readonly [string, string][]> {
	const result: [string, string][] = [];
	for (const [key, entry] of Object.entries(record(value))) {
		if (!key.startsWith("./") || key === "." || key.includes("*")) continue;
		const target =
			typeof entry === "string"
				? entry
				: [
						record(entry).source,
						record(entry).development,
						record(entry).import,
						record(entry).default,
					].find((item): item is string => typeof item === "string");
		if (!target) continue;
		const relative = target.replace(/^\.?\//, "").replace(/^dist\//, "src/");
		const extensionless = relative.replace(/\.(?:[cm]?[jt]sx?|css)$/, "");
		const candidates = target.startsWith("./src/")
			? [relative]
			: [
					...[".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs"].map(
						(extension) => `${extensionless}${extension}`,
					),
					path.join(extensionless, "index.ts"),
					path.join(extensionless, "index.tsx"),
					path.join(extensionless, "index.js"),
					relative,
				];
		for (const candidate of candidates) {
			const file = path.resolve(root, candidate);
			try {
				if ((await fs.stat(file)).isFile()) {
					result.push([key.slice(2), file]);
					break;
				}
			} catch {}
		}
	}
	return result;
}

function dependencies(manifest: Record<string, unknown>): Record<string, string> {
	const result: Record<string, string> = {};
	for (const section of dependencySections)
		for (const [name, value] of Object.entries(record(manifest[section])))
			if (typeof value === "string") result[name] = value;
	return result;
}

async function inferDependencies(
	item: WorkspacePackage,
	names: Map<string, WorkspacePackage>,
): Promise<string[]> {
	const found = new Set<string>();
	await walk(item.root, async (file) => {
		if (!/\.(?:[cm]?[jt]sx?)$/.test(file)) return;
		const text = await fs.readFile(file, "utf8");
		for (const name of names.keys())
			if (
				name !== item.name &&
				new RegExp(
					`(?:from\\s*|import\\s*\\(|require\\s*\\()\\s*["']${escapeRegExp(name)}(?:/[^"']*)?["']`,
				).test(text)
			)
				found.add(name);
	});
	return [...found].sort();
}

function matches(
	value: WorkspacePackage,
	filter?: WorkspaceFilter,
	target?: WorkspacePackage,
): boolean {
	if (!filter) return true;
	const relativeRoot = slash(value.root);
	return (
		(!filter.include?.length ||
			filter.include.some((pattern) => glob(relativeRoot, pattern) || glob(value.name, pattern))) &&
		!filter.exclude?.some((pattern) => glob(relativeRoot, pattern) || glob(value.name, pattern)) &&
		(filter.test?.(value, target) ?? true)
	);
}

function glob(value: string, pattern: string): boolean {
	const escaped = pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*\*/g, "<GLOBSTAR>")
		.replace(/\*/g, "[^/]*")
		.replace(/<GLOBSTAR>/g, ".*")
		.replace(/\?/g, ".");
	return new RegExp(`^${escaped}$`).test(value);
}

function projection(
	file: string,
	kind: WorkspaceProjection["kind"],
	current: string,
	next: string,
	diagnostics: WorkspaceDiagnostic[],
): WorkspaceProjection {
	return {
		file,
		kind,
		current,
		next,
		changed: normalize(current) !== normalize(next),
		diagnostics,
	};
}

function generatedDiagnostics(
	file: string,
	current: Record<string, unknown>,
	generated: Record<string, unknown>,
	label: string,
): WorkspaceDiagnostic[] {
	return Object.entries(generated)
		.filter(([key, value]) => JSON.stringify(current[key]) !== JSON.stringify(value))
		.map(([key, value]) => ({
			code: `workspace.${label}_missing`,
			severity: "warning",
			message: `${file}\n  missing ${label}: ${key} -> ${Array.isArray(value) ? value.join(", ") : value}`,
			file,
		}));
}

function parseJsonc(value: string): Record<string, unknown> {
	return JSON.parse(
		value
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/^\s*\/\/.*$/gm, "")
			.replace(/,\s*([}\]])/g, "$1"),
	);
}

function stableJson(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function normalize(value: string): string {
	try {
		return JSON.stringify(parseJsonc(value));
	} catch {
		return value;
	}
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function slash(value: string): string {
	return value.split(path.sep).join("/");
}

function relative(root: string, file: string): string {
	return slash(path.relative(root, file));
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function edgeSort(a: WorkspaceEdge, b: WorkspaceEdge): number {
	return `${a.from}:${a.to}:${a.type}`.localeCompare(`${b.from}:${b.to}:${b.type}`);
}

async function readOptional(file: string): Promise<string | undefined> {
	try {
		return await fs.readFile(file, "utf8");
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
		throw cause;
	}
}
