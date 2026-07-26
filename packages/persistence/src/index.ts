export type PersistenceKey = string;
export type PersistenceContext = {
	workspaceRoot: string;
	workspaceId?: string;
	sessionId?: string;
};
export type PersistedValue<T> = {
	value: T;
	updatedAt: string;
};
export type PersistedEntry = { key: PersistenceKey; updatedAt: string };
export type PersistenceListOptions = { limit?: number };
export type PersistenceAppendOptions = { flush?: boolean };

export interface PersistenceProvider {
	readonly id: string;
	initialize(context: PersistenceContext): Promise<void>;
	read<T>(key: PersistenceKey): Promise<PersistedValue<T> | undefined>;
	write<T>(key: PersistenceKey, value: T): Promise<void>;
	delete(key: PersistenceKey): Promise<void>;
	list(prefix?: PersistenceKey, options?: PersistenceListOptions): Promise<PersistedEntry[]>;
	append<T>(key: PersistenceKey, value: T, options?: PersistenceAppendOptions): Promise<void>;
	flush?(): Promise<void>;
	dispose(): Promise<void>;
}

export interface PluginStorage {
	get<T>(key: string): Promise<T | undefined>;
	set<T>(key: string, value: T): Promise<void>;
	delete(key: string): Promise<void>;
	list(prefix?: string): Promise<string[]>;
}

export type PersistedRecord<T> = {
	schema: string;
	version: number;
	workspaceId: string;
	sessionId?: string;
	createdAt: string;
	updatedAt: string;
	data: T;
};
export type WorkspaceIdentity = { id: string; createdAt: string; root: string };
export type RuntimeSession = {
	id: string;
	workspaceId: string;
	startedAt: string;
	endedAt?: string;
	exitReason?: "completed" | "shutdown" | "crashed" | "unknown";
	wsrtVersion: string;
	host: { hostname: string; platform: string; arch: string };
};

const SEGMENT = /^[A-Za-z0-9._:@-]+$/;
export function validatePersistenceKey(key: string): string {
	if (!key || key.startsWith("/") || key.endsWith("/") || key.includes("\\"))
		throw new Error(`Invalid persistence key: ${JSON.stringify(key)}`);
	const parts = key.split("/");
	if (parts.some((part) => !SEGMENT.test(part) || part === "." || part === ".."))
		throw new Error(`Invalid persistence key: ${JSON.stringify(key)}`);
	return key;
}
export function validatePluginId(id: string): string {
	if (!SEGMENT.test(id) || id === "." || id === "..")
		throw new Error(`Invalid plugin id: ${JSON.stringify(id)}`);
	return id;
}

export function createRecord<T>(
	schema: string,
	data: T,
	context: { workspaceId: string; sessionId?: string; previous?: PersistedRecord<T> },
): PersistedRecord<T> {
	const now = new Date().toISOString();
	return {
		schema,
		version: 1,
		workspaceId: context.workspaceId,
		...(context.sessionId ? { sessionId: context.sessionId } : {}),
		createdAt: context.previous?.createdAt ?? now,
		updatedAt: now,
		data,
	};
}

export type RecordMigration = (record: PersistedRecord<unknown>) => PersistedRecord<unknown>;
export class MigrationRegistry {
	readonly #versions = new Map<string, Map<number, RecordMigration>>();
	register(schema: string, version: number, migration: RecordMigration): this {
		const versions = this.#versions.get(schema) ?? new Map();
		versions.set(version, migration);
		this.#versions.set(schema, versions);
		return this;
	}
	read<T>(value: unknown, schema: string, currentVersion = 1): PersistedRecord<T> {
		if (!isRecord(value) || value.schema !== schema)
			throw new Error(`Invalid persisted record; expected schema "${schema}"`);
		let record = value;
		if (record.version > currentVersion)
			throw new Error(
				`Unsupported ${schema} record version ${record.version}; this WSRT supports up to ${currentVersion}`,
			);
		while (record.version < currentVersion) {
			const migration = this.#versions.get(schema)?.get(record.version);
			if (!migration)
				throw new Error(`No migration for ${schema} record version ${record.version}`);
			record = migration(record);
		}
		return record as PersistedRecord<T>;
	}
}
function isRecord(value: unknown): value is PersistedRecord<unknown> {
	if (!value || typeof value !== "object") return false;
	const item = value as Partial<PersistedRecord<unknown>>;
	return (
		typeof item.schema === "string" &&
		Number.isInteger(item.version) &&
		typeof item.workspaceId === "string" &&
		typeof item.createdAt === "string" &&
		typeof item.updatedAt === "string" &&
		"data" in item
	);
}

export function pluginStorage(provider: PersistenceProvider, pluginId: string): PluginStorage {
	validatePluginId(pluginId);
	const prefix = `plugin/${pluginId}`;
	const key = (value: string) => `${prefix}/${validatePersistenceKey(value)}`;
	return Object.freeze({
		async get<T>(value: string) {
			return (await provider.read<T>(key(value)))?.value;
		},
		set<T>(value: string, data: T) {
			return provider.write(key(value), data);
		},
		delete(value: string) {
			return provider.delete(key(value));
		},
		async list(value?: string) {
			const fullPrefix = value ? key(value) : prefix;
			return (await provider.list(fullPrefix)).map((entry) => entry.key.slice(prefix.length + 1));
		},
	});
}
