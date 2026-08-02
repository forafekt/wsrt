import fs from "node:fs/promises";
import path from "node:path";
import type { WorkspaceCapability } from "@wsrt/workspace-intelligence";
import { WORKSPACE_PROTOCOL_VERSION } from "./protocol.js";

export type WorkspaceManifest = Readonly<{
	schemaVersion: 1;
	workspace: Readonly<{ id: string; name: string; root: string }>;
	protocol: Readonly<{ name: "wsrt.workspace"; version: number }>;
	sessionDiscovery: Readonly<{ record: ".wsrt/session/record.json" }>;
	cli: Readonly<{ command: "wsrt workspace describe --json" }>;
	mcp: Readonly<{ command: "wsrt-mcp" }>;
	capabilities: readonly string[];
	consumerInstructions: ".wsrt/consumers.md";
}>;

export async function writeWorkspaceManifest(
	root: string,
	workspace: { id: string; name: string },
	capabilities: readonly WorkspaceCapability[],
): Promise<void> {
	const file = path.join(root, ".wsrt", "workspace-manifest.json");
	const value: WorkspaceManifest = {
		schemaVersion: 1,
		workspace: { id: workspace.id, name: workspace.name, root },
		protocol: { name: "wsrt.workspace", version: WORKSPACE_PROTOCOL_VERSION },
		sessionDiscovery: { record: ".wsrt/session/record.json" },
		cli: { command: "wsrt workspace describe --json" },
		mcp: { command: "wsrt-mcp" },
		capabilities: capabilities
			.filter(({ available }) => available)
			.map(({ id }) => id)
			.sort(),
		consumerInstructions: ".wsrt/consumers.md",
	};
	await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
	const temporary = `${file}.${process.pid}.tmp`;
	await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	await fs.rename(temporary, file);
}
