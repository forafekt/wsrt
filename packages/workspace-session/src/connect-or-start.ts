import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PlatformProcessIdentityProvider } from "./process-identity.js";
import { protocolError, type WorkspaceSessionHandshake } from "./protocol.js";
import { readSessionRecord, sessionPaths } from "./session-record.js";
import { validateRecordedSession } from "./session-validation.js";
import { WorkspaceTransportConnection } from "./transport.js";
import { discoverWorkspaceRoot, workspaceIdentity } from "./workspace-identity.js";
import { WorkspaceSessionClient } from "./workspace-session-client.js";

export interface ConnectWorkspaceOptions {
	readonly root?: string;
	readonly config?: string;
	readonly timeoutMs?: number;
	readonly start?: boolean;
}

export async function connectOrStartWorkspaceSession(
	options: ConnectWorkspaceOptions = {},
): Promise<WorkspaceSessionClient> {
	const root = await discoverWorkspaceRoot(options.root, options.config);
	const identity = await workspaceIdentity(root);
	const paths = sessionPaths(identity.root, identity.workspaceId);
	const existing = await connectRecorded(paths.record, identity.workspaceId, true);
	if (existing) return existing;
	if (options.start === false)
		throw protocolError("session.unavailable", "No active workspace session");
	await fs.mkdir(paths.directory, { recursive: true, mode: 0o700 });
	let elected = false;
	try {
		await fs.mkdir(paths.election);
		elected = true;
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
	}
	if (elected) {
		try {
			const entry = fileURLToPath(new URL("./host-entry.js", import.meta.url));
			const child = spawn(
				process.execPath,
				[entry, "--root", identity.root, ...(options.config ? ["--config", options.config] : [])],
				{ detached: true, stdio: "ignore", windowsHide: true },
			);
			child.unref();
		} catch (cause) {
			await fs.rmdir(paths.election).catch(() => {});
			throw Object.assign(new Error("Failed to launch workspace session host"), {
				code: "session.startup_failed",
				cause,
			});
		}
	}
	const deadline = Date.now() + (options.timeoutMs ?? 15_000);
	let last: unknown;
	while (Date.now() < deadline) {
		try {
			const client = await connectRecorded(paths.record, identity.workspaceId, false);
			if (client) return client;
		} catch (cause) {
			last = cause;
			if ((cause as { code?: string }).code !== "session.unavailable") throw cause;
		}
		await observableDelay(paths.record, Math.min(250, deadline - Date.now()));
	}
	throw Object.assign(new Error("Timed out waiting for workspace session host readiness"), {
		code: "session.startup_timeout",
		cause: last,
	});
}

async function connectRecorded(
	file: string,
	workspaceId: string,
	recoverStale: boolean,
): Promise<WorkspaceSessionClient | undefined> {
	const record = await readSessionRecord(file);
	if (!record) return undefined;
	let connection: WorkspaceTransportConnection | undefined;
	const validation = await validateRecordedSession(
		record,
		workspaceId,
		new PlatformProcessIdentityProvider(),
		async () => {
			connection = await WorkspaceTransportConnection.connect(record.endpoint);
			return (await connection.request({ type: "session.handshake" })) as WorkspaceSessionHandshake;
		},
	);
	if (validation.status === "stale") {
		await connection?.close().catch(() => {});
		if (!recoverStale)
			throw protocolError("session.unavailable", `Recorded session is stale: ${validation.reason}`);
		await fs.unlink(file).catch(() => {});
		if (record.endpoint.kind === "unix") await fs.unlink(record.endpoint.address).catch(() => {});
		return undefined;
	}
	if (validation.status !== "healthy") {
		await connection?.close().catch(() => {});
		throw protocolError(
			`session.${validation.status}`,
			`Workspace session is ${validation.status}: ${validation.reason}`,
			{ reason: validation.reason },
		);
	}
	if (!connection)
		throw protocolError("session.indeterminate", "Healthy session has no transport connection");
	try {
		return new WorkspaceSessionClient(connection, validation.handshake);
	} catch (cause) {
		await connection.close().catch(() => {});
		throw cause;
	}
}

async function observableDelay(file: string, timeout: number): Promise<void> {
	if (timeout <= 0) return;
	const watcher = fs.watch(file);
	await new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, timeout);
		void (async () => {
			try {
				for await (const _event of watcher) {
					clearTimeout(timer);
					resolve();
					break;
				}
			} catch {}
		})();
	}).finally(() => watcher.return?.());
}
