import fs from "node:fs/promises";
import path from "node:path";
import type { WorkspaceSessionHandshake } from "./protocol.js";

export interface WorkspaceEndpoint {
	readonly kind: "unix" | "pipe";
	readonly address: string;
}

export interface WorkspaceSessionRecord {
	readonly schemaVersion: 1;
	readonly protocolVersion: number;
	readonly workspaceId: string;
	readonly workspaceRoot: string;
	readonly sessionId: string;
	readonly pid: number;
	readonly processStartedAt: string;
	readonly processExecutable?: string;
	readonly endpoint: WorkspaceEndpoint;
	readonly createdAt: string;
}

export function sessionPaths(root: string, workspaceId: string) {
	const directory = path.join(root, ".wsrt", "session");
	const address =
		process.platform === "win32"
			? `\\\\.\\pipe\\wsrt-${workspaceId.slice(0, 24)}`
			: path.join(directory, "workspace.sock");
	return {
		directory,
		record: path.join(directory, "record.json"),
		election: path.join(directory, "startup.lock"),
		endpoint: {
			kind: process.platform === "win32" ? ("pipe" as const) : ("unix" as const),
			address,
		},
	};
}

export async function readSessionRecord(file: string): Promise<WorkspaceSessionRecord | undefined> {
	let value: unknown;
	try {
		value = JSON.parse(await fs.readFile(file, "utf8"));
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw Object.assign(new Error(`Malformed workspace session record: ${file}`), {
			code: "session.malformed_record",
			cause,
		});
	}
	if (
		!isRecord(value) ||
		value.schemaVersion !== 1 ||
		typeof value.protocolVersion !== "number" ||
		typeof value.workspaceId !== "string" ||
		typeof value.workspaceRoot !== "string" ||
		typeof value.sessionId !== "string" ||
		typeof value.pid !== "number" ||
		typeof value.processStartedAt !== "string" ||
		(value.processExecutable !== undefined && typeof value.processExecutable !== "string") ||
		!isRecord(value.endpoint) ||
		(value.endpoint.kind !== "unix" && value.endpoint.kind !== "pipe") ||
		typeof value.endpoint.address !== "string" ||
		typeof value.createdAt !== "string"
	)
		throw Object.assign(new Error(`Malformed workspace session record: ${file}`), {
			code: "session.malformed_record",
		});
	return value as unknown as WorkspaceSessionRecord;
}

export async function writeSessionRecord(
	file: string,
	value: WorkspaceSessionRecord,
): Promise<void> {
	const temporary = `${file}.${process.pid}.tmp`;
	await fs.writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
	await fs.rename(temporary, file);
}

export function recordMatchesHandshake(
	record: WorkspaceSessionRecord,
	handshake: WorkspaceSessionHandshake,
): boolean {
	return (
		record.workspaceId === handshake.workspaceId &&
		record.sessionId === handshake.sessionId &&
		record.pid === handshake.pid &&
		record.processStartedAt === handshake.processStartedAt
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
