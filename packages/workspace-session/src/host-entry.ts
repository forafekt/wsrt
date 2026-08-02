import fs from "node:fs/promises";
import process from "node:process";
import { sessionPaths } from "./session-record.js";
import { workspaceIdentity } from "./workspace-identity.js";
import { WorkspaceSessionHost } from "./workspace-session-host.js";

const rootIndex = process.argv.indexOf("--root");

const configIndex = process.argv.indexOf("--config");

const root = process.argv[rootIndex + 1];

const config = configIndex >= 0 ? process.argv[configIndex + 1] : undefined;

if (!root) throw new Error("Workspace host requires --root");

const identity = await workspaceIdentity(root);

const paths = sessionPaths(identity.root, identity.workspaceId);

const host = await WorkspaceSessionHost.create(identity.root, config);

try {
	await host.start();
	await fs.rmdir(paths.election).catch(() => {});
	const stop = () => void host.stop("signal");
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	await new Promise<void>((resolve) => process.once("beforeExit", resolve));
} catch (cause) {
	await fs.rmdir(paths.election).catch(() => {});
	process.stderr.write(`${cause instanceof Error ? cause.stack : String(cause)}\n`);
	process.exitCode = 1;
}
