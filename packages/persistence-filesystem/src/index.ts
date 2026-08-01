import { constants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	type PersistedEntry,
	type PersistedValue,
	type PersistenceAppendOptions,
	type PersistenceContext,
	type PersistenceKey,
	type PersistenceListOptions,
	type PersistenceProvider,
	validatePersistenceKey,
} from "@wsrt/persistence";

export type FilesystemPersistenceOptions = {
	root?: string;
	journals?: { maxFileSizeBytes?: number; maxFiles?: number; flushIntervalMs?: number };
};

type WorkspaceLock = {
	instanceId: string;
	sessionId: string;
	pid: number;
	hostname: string;
	startedAt: string;
};

type StoredValue<T> = { updatedAt: string; value: T };

export class FilesystemPersistenceProvider implements PersistenceProvider {
	readonly id = "filesystem";
	readonly #options: Required<FilesystemPersistenceOptions>;
	readonly #queues = new Map<string, Promise<void>>();
	readonly #pending = new Map<string, string[]>();
	#root?: string;
	#lock?: WorkspaceLock;
	#timer?: ReturnType<typeof setTimeout>;
	#initialized = false;
	#disposing = false;
	constructor(options: FilesystemPersistenceOptions = {}) {
		this.#options = {
			root: options.root ?? ".wsrt",
			journals: {
				maxFileSizeBytes: options.journals?.maxFileSizeBytes ?? 20 * 1024 * 1024,
				maxFiles: options.journals?.maxFiles ?? 5,
				flushIntervalMs: options.journals?.flushIntervalMs ?? 250,
			},
		};
	}
	get root(): string | undefined {
		return this.#root;
	}
	async initialize(context: PersistenceContext): Promise<void> {
		if (this.#initialized) return;
		if (this.#disposing) throw new Error("Filesystem persistence provider is disposed");
		const root = path.resolve(context.workspaceRoot, this.#options.root);
		if (!isWithin(path.resolve(context.workspaceRoot), root))
			throw new Error(`Persistence root escapes workspace: ${root}`);
		await fs.mkdir(root, { recursive: true, mode: 0o700 });
		const stat = await fs.lstat(root);
		if (stat.isSymbolicLink()) throw new Error(`Persistence root must not be a symlink: ${root}`);
		this.#root = await fs.realpath(root);
		try {
			await this.#acquireLock(context.sessionId ?? crypto.randomUUID());
			for (const directory of [
				"state",
				"sessions",
				"operations",
				"journals",
				"plugins",
				"artifacts",
				"cache",
				"runtime",
			])
				await fs.mkdir(path.join(this.#root, directory), { recursive: true, mode: 0o700 });
			await this.#cleanupTemporaryFiles();
			this.#initialized = true;
		} catch (cause) {
			await this.#releaseLock();
			this.#root = undefined;
			throw cause;
		}
	}
	async read<T>(key: PersistenceKey): Promise<PersistedValue<T> | undefined> {
		this.#assert();
		const file = await this.#file(key);
		try {
			const text = await fs.readFile(file, "utf8");
			const stored = JSON.parse(text) as StoredValue<T>;
			if (!stored || typeof stored.updatedAt !== "string" || !("value" in stored))
				throw new Error("missing stored-value fields");
			return stored;
		} catch (cause) {
			if (isNodeError(cause, "ENOENT")) return undefined;
			throw new Error(`Unable to read persisted key "${key}": ${errorMessage(cause)}`, {
				cause,
			});
		}
	}
	async write<T>(key: PersistenceKey, value: T): Promise<void> {
		this.#assertWritable();
		const file = await this.#file(key);
		return this.#serialize(key, async () => {
			await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
			await this.#assertNoSymlink(path.dirname(file));
			const stored: StoredValue<T> = { updatedAt: new Date().toISOString(), value };
			await atomicWrite(file, `${JSON.stringify(stored, null, 2)}\n`);
		});
	}
	async delete(key: PersistenceKey): Promise<void> {
		this.#assertWritable();
		const file = await this.#file(key);
		return this.#serialize(key, async () => {
			await fs.unlink(file).catch((cause) => {
				if (!isNodeError(cause, "ENOENT")) throw cause;
			});
		});
	}
	async list(prefix?: PersistenceKey, options?: PersistenceListOptions): Promise<PersistedEntry[]> {
		this.#assert();
		const valid = prefix ? validatePersistenceKey(prefix) : undefined;
		const files = await walk(required(this.#root));
		const entries: PersistedEntry[] = [];
		for (const file of files) {
			const key = this.#keyFromFile(file);
			if (!key || (valid && key !== valid && !key.startsWith(`${valid}/`))) continue;
			const stat = await fs.stat(file);
			entries.push({ key, updatedAt: stat.mtime.toISOString() });
		}
		return entries.sort((a, b) => a.key.localeCompare(b.key)).slice(0, options?.limit);
	}
	async append<T>(
		key: PersistenceKey,
		value: T,
		options?: PersistenceAppendOptions,
	): Promise<void> {
		this.#assertWritable();
		const valid = validatePersistenceKey(key);
		const line = `${JSON.stringify(value)}\n`;
		const pending = this.#pending.get(valid) ?? [];
		pending.push(line);
		this.#pending.set(valid, pending);
		if (options?.flush) await this.#flushJournal(valid);
		else this.#scheduleFlush();
	}
	async readJournal<T>(key: PersistenceKey): Promise<T[]> {
		this.#assert();
		await this.#flushJournal(validatePersistenceKey(key));
		const file = await this.#file(key, true);
		try {
			const text = await fs.readFile(file, "utf8");
			const lines = text.split("\n");
			const values: T[] = [];
			for (let index = 0; index < lines.length; index++) {
				const line = lines[index].trim();
				if (!line) continue;
				try {
					values.push(JSON.parse(line) as T);
				} catch {
					if (index < lines.length - 1)
						throw new Error(`Malformed NDJSON record at line ${index + 1}`);
					break;
				}
			}
			return values;
		} catch (cause) {
			if (isNodeError(cause, "ENOENT")) return [];
			throw new Error(`Unable to read journal "${key}": ${errorMessage(cause)}`, { cause });
		}
	}
	async flush(): Promise<void> {
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = undefined;
		await Promise.all([...this.#pending.keys()].map((key) => this.#flushJournal(key)));
		await Promise.all(this.#queues.values());
	}
	async dispose(): Promise<void> {
		if (this.#disposing) return;
		this.#disposing = true;
		try {
			if (this.#initialized) await this.flush();
		} finally {
			await this.#releaseLock();
			this.#initialized = false;
		}
	}
	async #file(key: string, journal = false): Promise<string> {
		const root = required(this.#root);
		const valid = validatePersistenceKey(key);
		const aliases: Record<string, string> = {
			"workspace/identity": "workspace.json",
			"snapshot/latest": "state/snapshot.json",
			"journal/events": "journals/events.ndjson",
			"journal/logs": "journals/logs.ndjson",
		};
		let relative = aliases[valid];
		if (!relative) {
			const [family, ...segments] = valid.split("/");
			const directory: Record<string, string> = {
				session: "sessions",
				operation: "operations",
				plugin: "plugins",
				artifact: "artifacts",
				cache: "cache",
				runtime: "runtime",
			};
			if (!directory[family] || !segments.length)
				throw new Error(`Unsupported persistence key family: ${valid}`);
			relative = path.join(directory[family], ...segments) + (journal ? ".ndjson" : ".json");
		}
		const file = path.resolve(root, relative);
		if (!isWithin(root, file)) throw new Error(`Persistence key escapes provider root: ${valid}`);
		return file;
	}
	#keyFromFile(file: string): string | undefined {
		const root = required(this.#root);
		const relative = path.relative(root, file).split(path.sep).join("/");
		const aliases: Record<string, string> = {
			"workspace.json": "workspace/identity",
			"state/snapshot.json": "snapshot/latest",
			"journals/events.ndjson": "journal/events",
			"journals/logs.ndjson": "journal/logs",
		};
		if (aliases[relative]) return aliases[relative];
		const match =
			/^(sessions|operations|plugins|artifacts|cache|runtime)\/(.+)\.(json|ndjson)$/.exec(relative);
		if (!match) return;
		const family: Record<string, string> = {
			sessions: "session",
			operations: "operation",
			plugins: "plugin",
			artifacts: "artifact",
			cache: "cache",
			runtime: "runtime",
		};
		return `${family[match[1]]}/${match[2]}`;
	}
	async #flushJournal(key: string): Promise<void> {
		const lines = this.#pending.get(key);
		if (!lines?.length) return;
		this.#pending.delete(key);
		const file = await this.#file(key, true);
		await this.#serialize(key, async () => {
			await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
			await this.#rotate(file, Buffer.byteLength(lines.join("")));
			await fs.appendFile(file, lines.join(""), { encoding: "utf8", mode: 0o600 });
		});
	}
	async #rotate(file: string, incoming: number): Promise<void> {
		const size = await fs
			.stat(file)
			.then((value) => value.size)
			.catch(() => 0);
		if (size + incoming <= this.#options.journals.maxFileSizeBytes) return;
		for (let index = this.#options.journals.maxFiles - 1; index >= 1; index--) {
			const source = index === 1 ? file : `${file}.${index - 1}`;
			const target = `${file}.${index}`;
			await fs.rename(source, target).catch((cause) => {
				if (!isNodeError(cause, "ENOENT")) throw cause;
			});
		}
	}
	#scheduleFlush(): void {
		if (this.#timer) return;
		this.#timer = setTimeout(() => {
			this.#timer = undefined;
			void this.flush();
		}, this.#options.journals.flushIntervalMs);
		this.#timer.unref?.();
	}
	#serialize(key: string, operation: () => Promise<void>): Promise<void> {
		const previous = this.#queues.get(key) ?? Promise.resolve();
		const current = previous.catch(() => {}).then(operation);
		this.#queues.set(key, current);
		void current.finally(() => {
			if (this.#queues.get(key) === current) this.#queues.delete(key);
		});
		return current;
	}
	async #acquireLock(sessionId: string): Promise<void> {
		const root = required(this.#root);
		const directory = path.join(root, "locks");
		const file = path.join(directory, "workspace.lock");
		await fs.mkdir(directory, { recursive: true, mode: 0o700 });
		const lock: WorkspaceLock = {
			instanceId: crypto.randomUUID(),
			sessionId,
			pid: process.pid,
			hostname: os.hostname(),
			startedAt: new Date().toISOString(),
		};
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const handle = await fs.open(
					file,
					constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
					0o600,
				);
				await handle.writeFile(`${JSON.stringify(lock, null, 2)}\n`);
				await handle.sync();
				await handle.close();
				this.#lock = lock;
				return;
			} catch (cause) {
				if (!isNodeError(cause, "EEXIST")) throw cause;
				const owner = await readJson<WorkspaceLock>(file);
				if (!owner || !lockIsLive(owner)) {
					await fs.unlink(file).catch(() => {});
					continue;
				}
				throw new Error(
					`WSRT workspace is already locked by pid ${owner.pid} on ${owner.hostname} (session ${owner.sessionId})`,
				);
			}
		}
		throw new Error("Unable to acquire WSRT workspace lock");
	}
	async #releaseLock(): Promise<void> {
		if (!this.#root || !this.#lock) return;
		const file = path.join(this.#root, "locks", "workspace.lock");
		const owner = await readJson<WorkspaceLock>(file);
		if (owner?.instanceId === this.#lock.instanceId) await fs.unlink(file).catch(() => {});
		this.#lock = undefined;
	}
	async #cleanupTemporaryFiles(): Promise<void> {
		const root = required(this.#root);
		for (const file of await walk(root))
			if (path.basename(file).includes(".tmp-")) await fs.unlink(file).catch(() => {});
	}
	async #assertNoSymlink(directory: string): Promise<void> {
		const root = required(this.#root);
		let current = directory;
		while (current !== root) {
			const stat = await fs.lstat(current);
			if (stat.isSymbolicLink()) throw new Error(`Refusing to write through symlink: ${current}`);
			current = path.dirname(current);
		}
	}
	#assert(): void {
		if (!this.#initialized) throw new Error("Filesystem persistence provider is not initialized");
	}
	#assertWritable(): void {
		this.#assert();
		if (this.#disposing) throw new Error("Filesystem persistence provider is disposing");
	}
}

export function filesystemPersistence(
	options?: FilesystemPersistenceOptions,
): FilesystemPersistenceProvider {
	return new FilesystemPersistenceProvider(options);
}

async function atomicWrite(file: string, contents: string): Promise<void> {
	const temporary = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
	let handle: fs.FileHandle | undefined;
	try {
		handle = await fs.open(temporary, "wx", 0o600);
		await handle.writeFile(contents);
		await handle.sync();
		await handle.close();
		handle = undefined;
		await fs.rename(temporary, file);
	} finally {
		await handle?.close().catch(() => {});
		await fs.unlink(temporary).catch(() => {});
	}
}

async function walk(directory: string): Promise<string[]> {
	const result: string[] = [];
	for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
		const file = path.join(directory, entry.name);
		if (entry.isSymbolicLink()) continue;
		if (entry.isDirectory()) result.push(...(await walk(file)));
		else if (entry.isFile()) result.push(file);
	}
	return result;
}

function isWithin(root: string, target: string): boolean {
	const relative = path.relative(root, target);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isNodeError(cause: unknown, code: string): cause is NodeJS.ErrnoException {
	return cause instanceof Error && "code" in cause && cause.code === code;
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("Filesystem persistence provider is not initialized");
	return value;
}

async function readJson<T>(file: string): Promise<T | undefined> {
	try {
		return JSON.parse(await fs.readFile(file, "utf8")) as T;
	} catch {
		return undefined;
	}
}

function lockIsLive(lock: WorkspaceLock): boolean {
	if (lock.hostname !== os.hostname()) return true;
	try {
		process.kill(lock.pid, 0);
		return true;
	} catch (cause) {
		return !isNodeError(cause, "ESRCH");
	}
}
