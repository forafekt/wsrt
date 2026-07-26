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

export class MemoryPersistenceProvider implements PersistenceProvider {
	readonly id = "memory";
	readonly #values = new Map<string, PersistedValue<unknown>>();
	readonly #journals = new Map<string, unknown[]>();
	#initialized = false;
	#disposed = false;
	async initialize(_context: PersistenceContext): Promise<void> {
		if (this.#disposed) throw new Error("Memory persistence provider is disposed");
		this.#initialized = true;
	}
	async read<T>(key: PersistenceKey): Promise<PersistedValue<T> | undefined> {
		this.#assert();
		const value = this.#values.get(validatePersistenceKey(key));
		return value ? structuredClone(value as PersistedValue<T>) : undefined;
	}
	async write<T>(key: PersistenceKey, value: T): Promise<void> {
		this.#assert();
		this.#values.set(validatePersistenceKey(key), {
			value: structuredClone(value),
			updatedAt: new Date().toISOString(),
		});
	}
	async delete(key: PersistenceKey): Promise<void> {
		this.#assert();
		const valid = validatePersistenceKey(key);
		this.#values.delete(valid);
		this.#journals.delete(valid);
	}
	async list(prefix?: PersistenceKey, options?: PersistenceListOptions): Promise<PersistedEntry[]> {
		this.#assert();
		const valid = prefix ? validatePersistenceKey(prefix) : undefined;
		return [...new Set([...this.#values.keys(), ...this.#journals.keys()])]
			.filter((key) => !valid || key === valid || key.startsWith(`${valid}/`))
			.sort()
			.slice(0, options?.limit)
			.map((key) => ({
				key,
				updatedAt: this.#values.get(key)?.updatedAt ?? new Date(0).toISOString(),
			}));
	}
	async append<T>(
		key: PersistenceKey,
		value: T,
		_options?: PersistenceAppendOptions,
	): Promise<void> {
		this.#assert();
		const valid = validatePersistenceKey(key);
		const journal = this.#journals.get(valid) ?? [];
		journal.push(structuredClone(value));
		this.#journals.set(valid, journal);
	}
	journal<T>(key: string): readonly T[] {
		return structuredClone(this.#journals.get(validatePersistenceKey(key)) ?? []) as T[];
	}
	entries(): ReadonlyMap<string, PersistedValue<unknown>> {
		return new Map(structuredClone([...this.#values]));
	}
	async flush(): Promise<void> {}
	async dispose(): Promise<void> {
		this.#disposed = true;
	}
	#assert(): void {
		if (!this.#initialized) throw new Error("Memory persistence provider is not initialized");
		if (this.#disposed) throw new Error("Memory persistence provider is disposed");
	}
}

export function memoryPersistence(): MemoryPersistenceProvider {
	return new MemoryPersistenceProvider();
}
