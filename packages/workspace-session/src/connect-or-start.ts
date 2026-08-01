import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
	protocolError,
	WORKSPACE_PROTOCOL_VERSION,
	type WorkspaceSessionHandshake,
} from "./protocol.js";
import {
	readSessionRecord,
	recordMatchesHandshake,
	sessionPaths,
	type WorkspaceSessionRecord,
} from "./session-record.js";
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
	const existing = await connectRecorded(paths.record, identity.workspaceId).catch((cause) => {
		if (!recoverable(cause)) throw cause;
		return undefined;
	});
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
			const client = await connectRecorded(paths.record, identity.workspaceId);
			if (client) return client;
		} catch (cause) {
			last = cause;
			if (!recoverable(cause)) throw cause;
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
): Promise<WorkspaceSessionClient | undefined> {
	const record = await readSessionRecord(file);
	if (!record) return undefined;
	if (record.workspaceId !== workspaceId)
		throw protocolError(
			"workspace.identity_mismatch",
			"Session record belongs to another workspace",
		);
	const connection = await WorkspaceTransportConnection.connect(record.endpoint);
	try {
		const handshake = (await connection.request({
			type: "session.handshake",
		})) as WorkspaceSessionHandshake;
		validateHandshake(record, handshake);
		return new WorkspaceSessionClient(connection, handshake);
	} catch (cause) {
		await connection.close().catch(() => {});
		throw cause;
	}
}
function validateHandshake(record: WorkspaceSessionRecord, value: WorkspaceSessionHandshake) {
	if (value.protocolVersion !== WORKSPACE_PROTOCOL_VERSION)
		throw protocolError(
			"protocol.version_mismatch",
			`Host protocol ${value.protocolVersion} is incompatible with client protocol ${WORKSPACE_PROTOCOL_VERSION}`,
		);
	if (!recordMatchesHandshake(record, value))
		throw protocolError(
			"session.identity_mismatch",
			"Session handshake does not match its discovery record",
		);
}
function recoverable(cause: unknown): boolean {
	const code = (cause as { code?: string })?.code;
	return !code || ["transport.unavailable", "session.malformed_record"].includes(code);
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
