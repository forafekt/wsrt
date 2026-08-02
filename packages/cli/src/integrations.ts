import fs from "node:fs/promises";
import path from "node:path";
import type { WorkspaceSessionClient } from "@wsrt/workspace-session";

export const integrationTargets = Object.freeze([
	{ id: "mcp", supported: true, file: ".wsrt/consumers.md" },
	{ id: "codex", supported: true, file: "AGENTS.md" },
	{ id: "claude", supported: true, file: "CLAUDE.md" },
	{ id: "vscode", supported: false, file: ".vscode/settings.json" },
] as const);

const canonicalBody = `# WSRT consumer instructions

Query the authoritative WSRT workspace protocol before broad repository scanning.

- Use \`workspace.describe\` for declared architecture, projects, nodes, relationships, capabilities, and live runtime references.
- Use node and graph queries to narrow scope and understand declared dependencies.
- Use file queries before broad file searches to locate declared source, configuration, tests, generated files, task inputs, and outputs.
- Read the returned source files for implementation details and source-level semantics.
- Treat WSRT as authoritative for declared workspace architecture and live runtime state, not undocumented intent or arbitrary code meaning.
`;

export async function setupIntegration(
	root: string,
	target: string,
	client: WorkspaceSessionClient,
): Promise<{ target: string; files: readonly string[]; changed: boolean }> {
	const adapter = integrationTargets.find(({ id }) => id === target);
	if (!adapter) throw coded("integration.unknown", `Unknown integration target ${target}`);
	if (!adapter.supported)
		throw coded("integration.unsupported", `Integration target ${target} is not supported yet`);
	await client.getCapabilities();
	const files: string[] = [];
	let changed = await patchManaged(
		path.join(root, ".wsrt", "consumers.md"),
		"canonical",
		canonicalBody,
	);
	files.push(".wsrt/consumers.md");
	if (target === "codex" || target === "claude") {
		const file = target === "codex" ? "AGENTS.md" : "CLAUDE.md";
		changed =
			(await patchManaged(
				path.join(root, file),
				"consumer-reference",
				"Follow the canonical WSRT consumer instructions in `.wsrt/consumers.md`.",
			)) || changed;
		files.push(file);
	}
	return { target, files, changed };
}

export async function removeIntegration(
	root: string,
	target: string,
): Promise<{ target: string; files: readonly string[]; changed: boolean }> {
	const adapter = integrationTargets.find(({ id }) => id === target);
	if (!adapter) throw coded("integration.unknown", `Unknown integration target ${target}`);
	const files: string[] = [];
	let changed = false;
	if (target === "codex" || target === "claude") {
		const file = target === "codex" ? "AGENTS.md" : "CLAUDE.md";
		changed = await removeManaged(path.join(root, file), "consumer-reference");
		files.push(file);
	} else if (target === "mcp") {
		changed = await removeManaged(path.join(root, ".wsrt", "consumers.md"), "canonical");
		files.push(".wsrt/consumers.md");
	}
	return { target, files, changed };
}

async function patchManaged(file: string, id: string, body: string): Promise<boolean> {
	const current = await readOptional(file);
	const start = `<!-- wsrt:${id}:start -->`;
	const end = `<!-- wsrt:${id}:end -->`;
	const block = `${start}\n${body.trim()}\n${end}`;
	const expression = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, "m");
	const next = expression.test(current)
		? current.replace(expression, block)
		: `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${block}\n`;
	if (next === current) return false;
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, next, "utf8");
	return true;
}

async function removeManaged(file: string, id: string): Promise<boolean> {
	const current = await readOptional(file);
	const expression = new RegExp(
		`(?:\\n\\n)?${escapeRegExp(`<!-- wsrt:${id}:start -->`)}[\\s\\S]*?${escapeRegExp(`<!-- wsrt:${id}:end -->`)}\\n?`,
		"m",
	);
	if (!expression.test(current)) return false;
	await fs.writeFile(
		file,
		current.replace(expression, "").trimEnd() +
			(current.replace(expression, "").trim() ? "\n" : ""),
		"utf8",
	);
	return true;
}

async function readOptional(file: string): Promise<string> {
	return fs.readFile(file, "utf8").catch((cause) => {
		if ((cause as NodeJS.ErrnoException).code === "ENOENT") return "";
		throw cause;
	});
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function coded(code: string, message: string): Error & { code: string } {
	return Object.assign(new Error(message), { code });
}
