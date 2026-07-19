import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExecutionTelemetryEvent } from "@wsrt/capabilities";

export const telemetryProtocol = "wsrt.execution-telemetry" as const;
export const telemetryVersion = 1 as const;
export const maximumTelemetryRecordBytes = 64 * 1024;
export const maximumTelemetryFileBytes = 8 * 1024 * 1024;
const temporaryRoot = path.join(os.tmpdir(), "wsrt", "executions");

export type ExecutionTelemetryEnvelope = {
	readonly protocol: typeof telemetryProtocol;
	readonly version: typeof telemetryVersion;
	readonly sequence: number;
	readonly timestamp: string;
	readonly executionId: string;
	readonly nodeId?: string;
	readonly operationId?: string;
	readonly event: ExecutionTelemetryEvent;
};

export type TelemetryIssue = {
	readonly code:
		| "WSRT_TELEMETRY_MALFORMED_RECORD"
		| "WSRT_TELEMETRY_OVERSIZED_RECORD"
		| "WSRT_TELEMETRY_PROTOCOL_MISMATCH"
		| "WSRT_TELEMETRY_EXECUTION_MISMATCH"
		| "WSRT_TELEMETRY_SEQUENCE_INVALID";
	readonly message: string;
};

export type OwnedExecutionState = {
	readonly executionId: string;
	readonly directory: string;
	readonly telemetryFile: string;
	readonly manifestFile: string;
};

export function createOwnedExecutionState(): OwnedExecutionState {
	cleanupStaleExecutionState();
	fs.mkdirSync(temporaryRoot, { recursive: true, mode: 0o700 });
	const executionId = randomUUID();
	const directory = fs.mkdtempSync(path.join(temporaryRoot, `${executionId}-`));
	fs.chmodSync(directory, 0o700);
	const telemetryFile = path.join(directory, "telemetry.jsonl");
	const manifestFile = path.join(directory, "owner.json");
	fs.writeFileSync(telemetryFile, "", { flag: "wx", mode: 0o600 });
	fs.writeFileSync(
		manifestFile,
		JSON.stringify({
			protocol: telemetryProtocol,
			version: telemetryVersion,
			executionId,
			pid: process.pid,
			createdAt: new Date().toISOString(),
		}),
		{ flag: "wx", mode: 0o600 },
	);
	return Object.freeze({ executionId, directory, telemetryFile, manifestFile });
}

export async function removeOwnedExecutionState(state: OwnedExecutionState): Promise<void> {
	if (!isWithinTemporaryRoot(state.directory)) return;
	try {
		const manifest = JSON.parse(await fsp.readFile(state.manifestFile, "utf8"));
		if (manifest.protocol !== telemetryProtocol || manifest.executionId !== state.executionId)
			return;
		await fsp.rm(state.directory, { recursive: true, force: true });
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
	}
}

export function cleanupStaleExecutionState(
	options: { now?: number; minimumAgeMs?: number; dryRun?: boolean } = {},
): readonly string[] {
	const removed: string[] = [];
	const now = options.now ?? Date.now();
	const minimumAgeMs = options.minimumAgeMs ?? 24 * 60 * 60 * 1000;
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(temporaryRoot, { withFileTypes: true }).slice(0, 100);
	} catch {
		return removed;
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const directory = path.join(temporaryRoot, entry.name);
		try {
			const manifest = JSON.parse(fs.readFileSync(path.join(directory, "owner.json"), "utf8"));
			const createdAt = Date.parse(manifest.createdAt);
			if (
				manifest.protocol !== telemetryProtocol ||
				manifest.version !== telemetryVersion ||
				typeof manifest.executionId !== "string" ||
				!Number.isFinite(createdAt) ||
				now - createdAt < minimumAgeMs ||
				isProcessAlive(manifest.pid)
			)
				continue;
			removed.push(directory);
			if (!options.dryRun) fs.rmSync(directory, { recursive: true, force: true });
		} catch {}
	}
	return Object.freeze(removed);
}

export class ExecutionTelemetryReader {
	#offset = 0;
	#remainder = "";
	#sequence = 0;
	#state: "created" | "active" | "closing" | "closed" = "created";
	#malformed = 0;
	constructor(
		readonly file: string,
		readonly executionId: string,
		readonly maximumDiagnostics = 5,
	) {}
	get state() {
		return this.#state;
	}
	async read(): Promise<{
		records: readonly ExecutionTelemetryEnvelope[];
		issues: readonly TelemetryIssue[];
	}> {
		if (this.#state === "closing" || this.#state === "closed") return { records: [], issues: [] };
		this.#state = "active";
		let bytes: Buffer;
		try {
			const stat = await fsp.stat(this.file);
			if (stat.size > maximumTelemetryFileBytes)
				return this.#issue(
					"WSRT_TELEMETRY_OVERSIZED_RECORD",
					"Telemetry file exceeds its size limit",
				);
			const handle = await fsp.open(this.file, "r");
			try {
				bytes = Buffer.alloc(Math.max(0, stat.size - this.#offset));
				const result = await handle.read(bytes, 0, bytes.length, this.#offset);
				bytes = bytes.subarray(0, result.bytesRead);
				this.#offset += result.bytesRead;
			} finally {
				await handle.close();
			}
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { records: [], issues: [] };
			throw cause;
		}
		const lines = `${this.#remainder}${bytes.toString("utf8")}`.split("\n");
		this.#remainder = lines.pop() ?? "";
		const records: ExecutionTelemetryEnvelope[] = [];
		const issues: TelemetryIssue[] = [];
		for (const line of lines) {
			if (!line) continue;
			if (Buffer.byteLength(line) > maximumTelemetryRecordBytes) {
				this.#pushIssue(
					issues,
					"WSRT_TELEMETRY_OVERSIZED_RECORD",
					"Telemetry record exceeds its size limit",
				);
				continue;
			}
			const parsed = validateEnvelope(line, this.executionId, this.#sequence);
			if ("issue" in parsed) {
				this.#pushIssue(issues, parsed.issue.code, parsed.issue.message);
				continue;
			}
			this.#sequence = parsed.value.sequence;
			records.push(parsed.value);
		}
		return { records: Object.freeze(records), issues: Object.freeze(issues) };
	}
	async close(options: { drain?: boolean } = {}): Promise<readonly ExecutionTelemetryEnvelope[]> {
		if (this.#state === "closed") return [];
		this.#state = "closing";
		if (!options.drain) {
			this.#state = "closed";
			this.#remainder = "";
			return [];
		}
		this.#state = "active";
		const result = await this.read();
		this.#state = "closed";
		this.#remainder = "";
		return result.records;
	}
	#issue(code: TelemetryIssue["code"], message: string) {
		const issues: TelemetryIssue[] = [];
		this.#pushIssue(issues, code, message);
		return { records: [], issues };
	}
	#pushIssue(issues: TelemetryIssue[], code: TelemetryIssue["code"], message: string) {
		if (this.#malformed++ < this.maximumDiagnostics) issues.push({ code, message });
	}
}

export function createEnvelope(
	executionId: string,
	sequence: number,
	event: ExecutionTelemetryEvent,
	attributes: { nodeId?: string; operationId?: string } = {},
): ExecutionTelemetryEnvelope {
	return Object.freeze({
		protocol: telemetryProtocol,
		version: telemetryVersion,
		sequence,
		timestamp: new Date().toISOString(),
		executionId,
		...attributes,
		event,
	});
}

function validateEnvelope(
	line: string,
	executionId: string,
	lastSequence: number,
): { value: ExecutionTelemetryEnvelope } | { issue: TelemetryIssue } {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		return issue("WSRT_TELEMETRY_MALFORMED_RECORD", "Telemetry record is not valid JSON");
	}
	if (
		!isRecord(value) ||
		value.protocol !== telemetryProtocol ||
		value.version !== telemetryVersion
	)
		return issue(
			"WSRT_TELEMETRY_PROTOCOL_MISMATCH",
			"Telemetry protocol or version is unsupported",
		);
	if (value.executionId !== executionId)
		return issue("WSRT_TELEMETRY_EXECUTION_MISMATCH", "Telemetry belongs to another execution");
	if (!Number.isSafeInteger(value.sequence) || Number(value.sequence) <= lastSequence)
		return issue(
			"WSRT_TELEMETRY_SEQUENCE_INVALID",
			"Telemetry sequence is duplicate or out of order",
		);
	if (
		typeof value.timestamp !== "string" ||
		!Number.isFinite(Date.parse(value.timestamp)) ||
		!isEvent(value.event)
	)
		return issue("WSRT_TELEMETRY_MALFORMED_RECORD", "Telemetry envelope fields are invalid");
	return { value: value as ExecutionTelemetryEnvelope };
}

function isEvent(value: unknown): value is ExecutionTelemetryEvent {
	if (!isRecord(value) || typeof value.type !== "string") return false;
	if (value.type === "execution.started")
		return value.timestamp === undefined || typeof value.timestamp === "string";
	if (value.type === "server.listening")
		return (
			typeof value.host === "string" &&
			Number.isInteger(value.port) &&
			Number(value.port) >= 0 &&
			Number(value.port) <= 65535 &&
			(value.urls === undefined ||
				(Array.isArray(value.urls) && value.urls.every((url) => typeof url === "string")))
		);
	if (value.type === "readiness.available")
		return value.details === undefined || isRecord(value.details);
	if (value.type === "artifact.discovered")
		return (
			isRecord(value.artifact) &&
			typeof value.artifact.path === "string" &&
			value.artifact.path.length > 0 &&
			!path.isAbsolute(value.artifact.path) &&
			!value.artifact.path.split(/[\\/]/).includes("..")
		);
	if (value.type === "diagnostic")
		return (
			isRecord(value.diagnostic) &&
			typeof value.diagnostic.code === "string" &&
			["info", "warning", "error"].includes(String(value.diagnostic.severity)) &&
			typeof value.diagnostic.message === "string"
		);
	if (value.type === "custom")
		return typeof value.namespace === "string" && typeof value.name === "string";
	return false;
}

function issue(code: TelemetryIssue["code"], message: string) {
	return { issue: { code, message } } as const;
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
function isWithinTemporaryRoot(value: string): boolean {
	const relative = path.relative(temporaryRoot, value);
	return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
function isProcessAlive(pid: unknown): boolean {
	if (!Number.isSafeInteger(pid) || Number(pid) <= 0) return false;
	try {
		process.kill(Number(pid), 0);
		return true;
	} catch (cause) {
		return (cause as NodeJS.ErrnoException).code === "EPERM";
	}
}
