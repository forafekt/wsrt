/**
 * @wsrt/di
 *
 * A TypeScript dependency injection container
 *
 * @module
 */

/* ───────────────────────────────── Internal Types ───────────────────────────── */

/**
 * Dependencies for a service factory
 *
 * - This is a readonly array of strings that represent the names of the services that this factory requires
 * - The container will resolve these dependencies before calling the factory function
 */
type DIServiceDependencies = readonly string[];

/**
 * Service registration type
 *
 * - This is a type that represents the different ways a service can be registered
 * - It can be an instance, a factory, or a singleton
 */
type DIServiceRegistration<T, Entries extends Record<string, unknown>> =
	| { type: "instance"; value: T }
	| { type: "factory"; value: DIServiceFactory<T, Entries> }
	| { type: "singleton"; value: DIServiceFactory<T, Entries>; singleton?: T };

/* ───────────────────────────────── Public Types ───────────────────────────── */

/**
 * Factory function for creating a service instance
 *
 * - This is a function that receives the container and returns a service instance
 * - The container will call this function every time the service is requested
 * - This is useful when you want to create a new instance every time
 */
export interface DIServiceFactory<T, Entries extends Record<string, unknown>> {
	/**
	 * Factory function that receives the container and returns a service instance
	 */
	(container: Container<Entries>): T | Promise<T>;
	/**
	 * Optional dependencies that this factory requires
	 *
	 * - This is a readonly array of strings that represent the names of the services that this factory requires
	 * - The container will resolve these dependencies before calling the factory function
	 */
	dependsOn?: DIServiceDependencies;
}

/**
 * Interface for disposable resources
 *
 * - This is an interface that defines a dispose method for cleaning up resources
 * - The container will call this method when the container is disposed
 */
export interface DIDisposable {
	/**
	 * Dispose method for cleaning up resources
	 */
	dispose(): void | Promise<void>;
}

/**
 * Interface for the dependency injection container
 *
 * - This is the main interface for the dependency injection container
 * - It provides methods for registering and resolving services
 */
export interface Container<Entries extends Record<string, unknown> = any> {
	/**
	 * Register a service instance
	 *
	 * - You are registering a concrete instance of a service
	 * - The container will return this instance every time it is requested
	 * - This is useful for testing or when you want to provide a specific instance
	 */
	register<T>(name: string, instance: T): void;

	/**
	 * Register a factory function
	 *
	 * - You are registering a function that will create a service instance
	 * - The container will call this function every time the service is requested
	 * - This is useful when you want to create a new instance every time
	 */
	registerFactory<T, E extends Entries = Entries>(
		name: string,
		factory: DIServiceFactory<T, E>,
	): void;

	/**
	 * Register a singleton factory
	 *
	 * - You are registering a function that will create a service instance
	 * - The container will call this function only once and cache the result
	 * - This is useful when you want to create a single instance that is shared across the application
	 */
	registerSingleton<T, E extends Entries = Entries>(
		name: string,
		factory: DIServiceFactory<T, E>,
	): void;

	/**
	 * Resolve a service
	 *
	 * - You are requesting a service from the container synchronously
	 * - The container will return the service instance or create it if it doesn't exist
	 * - This is the main way to get services from the container when the factory is synchronous
	 */
	resolve<T, K extends keyof Entries = keyof Entries>(name: K): T extends object ? T : Entries[K];

	/**
	 * Resolve a service asynchronously
	 *
	 * - You are requesting a service from the container asynchronously
	 * - The container will return the service instance or create it if it doesn't exist
	 * - This is the main way to get services from the container when the factory is async
	 */
	resolveAsync<T, K extends keyof Entries = keyof Entries>(
		name: K,
	): Promise<T extends object ? T : Entries[K]>;

	/**
	 * Check if a service is registered
	 *
	 * - You are checking if a service is registered in the container
	 * - This is useful when you want to know if a service exists before trying to resolve it
	 */
	has<K extends keyof Entries = keyof Entries>(name: K): boolean;

	/**
	 * Create a child container
	 *
	 * - You are creating a new container that inherits from the current container
	 * - This is useful when you want to create a new scope for services
	 */
	createChild<
		ChildEntries extends Record<string, unknown> = Record<string, unknown>,
	>(): Container<ChildEntries>;

	/**
	 * Get the parent container
	 *
	 * - You are getting the parent container from the current container
	 * - This is useful when you want to access services from the parent container
	 */
	getParent(): Container<Entries> | null;

	/**
	 * Get the parent container or the current container if there is no parent
	 *
	 * - You are getting the parent container from the current container
	 * - If there is no parent container, you get the current container
	 * - This is useful when you want to access services from the parent container or the current container
	 */
	getParentOrCurrent(): Container<Entries>;

	/**
	 * List all registered services
	 *
	 * - You are getting a list of all services that are registered in the container
	 * - This is useful when you want to know what services are available
	 */
	list(): (keyof Entries)[];

	/**
	 * Clear all services
	 *
	 * - You are removing all services from the container
	 * - This is useful when you want to reset the container
	 */
	clear(): void;
}

/* ───────────────────────────────── Container ───────────────────────────── */

/**
 * Dependency injection container implementation
 *
 * - This is the main implementation of the Container interface
 * - It provides methods for registering and resolving services
 */
export default class DIContainer<Entries extends Record<string, unknown> = Record<string, unknown>>
	implements Container<Entries>
{
	private services = new Map<string, DIServiceRegistration<unknown, Entries>>();
	private parent: DIContainer<any> | null;
	private disposed = false;

	constructor(parent?: DIContainer<any>) {
		this.parent = parent ?? null;
	}

	/* ───────────────────────────────── Registration ───────────────────────────── */

	register<T>(name: string, instance: T): void {
		this.assertAlive();
		this.services.set(name, { type: "instance", value: instance });
	}

	registerFactory<T, E extends Entries = Entries>(
		name: string,
		factory: DIServiceFactory<T, E>,
	): void {
		this.assertAlive();
		this.services.set(name, { type: "factory", value: factory });
	}

	registerSingleton<T, E extends Entries = Entries>(
		name: string,
		factory: DIServiceFactory<T, E>,
	): void {
		this.assertAlive();

		// Explicit dependency intent warning
		if (factory?.dependsOn && factory.dependsOn.length > 0) {
			console.warn(
				`[${this.constructor.name}] Singleton '${name}' depends on ${factory.dependsOn.join(", ")} — this is unsafe.`,
			);
		}

		this.services.set(name, { type: "singleton", value: factory });
	}

	/* ───────────────────────────────── Resolution ───────────────────────────── */

	resolve<T, K extends keyof Entries = keyof Entries>(name: K): T extends object ? T : Entries[K] {
		type R = T extends object ? T : Entries[K];
		const reg = this.getRegistrationDeep(String(name));

		if (!reg) {
			throw new Error(`Service not found: ${String(name)}`);
		}

		if (reg.type === "instance") {
			return reg.value as R;
		}

		if (reg.type === "factory") {
			const result = reg.value(this as Container<Entries>);
			if (result instanceof Promise) {
				throw new Error(`Service '${String(name)}' is async. Use resolveAsync().`);
			}
			return result as R;
		}

		// singleton
		if (reg.singleton !== undefined) {
			return reg.singleton as R;
		}

		// Warn if singleton is resolved from a child container
		if (this.parent) {
			console.warn(
				`[${this.constructor.name}] Singleton '${String(name)}' is being resolved from a child container. This may capture scoped dependencies.`,
			);
		}

		const result = reg.value(this as Container<Entries>);
		if (result instanceof Promise) {
			throw new Error(`Service '${String(name)}' is async. Use resolveAsync().`);
		}

		reg.singleton = result;
		return result as R;
	}

	async resolveAsync<T, K extends keyof Entries = keyof Entries>(
		name: K,
	): Promise<T extends object ? T : Entries[K]> {
		type R = T extends object ? T : Entries[K];
		const reg = this.getRegistrationDeep(String(name));

		if (!reg) {
			throw new Error(`Service not found: ${String(name)}`);
		}

		if (reg.type === "instance") {
			return reg.value as R;
		}

		if (reg.type === "factory") {
			return (await Promise.resolve(reg.value(this as Container<Entries>))) as R;
		}

		// singleton
		if (reg.singleton !== undefined) {
			return reg.singleton as R;
		}

		if (this.parent) {
			console.warn(
				`[${this.constructor.name}] Singleton '${String(name)}' is being resolved from a child container. This may capture scoped dependencies.`,
			);
		}

		const result = await Promise.resolve(reg.value(this as Container<Entries>));
		reg.singleton = result;
		return result as R;
	}

	/* ───────────────────────────────── Scoping ───────────────────────────── */

	createChild<
		ChildEntries extends Record<string, unknown> = Record<string, unknown>,
	>(): Container<ChildEntries> {
		return new DIContainer<ChildEntries>(this);
	}

	getParent(): Container<Entries> | null {
		return this.parent as Container<Entries> | null;
	}

	getParentOrCurrent(): Container<Entries> {
		return (this.parent ?? this) as Container<Entries>;
	}

	/* ───────────────────────────────── Introspection ───────────────────────────── */

	has(name: keyof Entries): boolean {
		return this.services.has(String(name)) || (this.parent?.has(name) ?? false);
	}

	list(): (keyof Entries)[] {
		const local = Array.from(this.services.keys());
		if (!this.parent) {
			return local as (keyof Entries)[];
		}

		const parent = this.parent.list().filter((k) => !this.services.has(String(k)));

		return [...local, ...parent] as (keyof Entries)[];
	}

	/* ───────────────────────────────── Cleanup & Disposal ───────────────────────────── */

	/**
	 * Disposes all singleton services and clears the container
	 *
	 * - It calls the dispose method on all singleton services
	 * - It clears the container
	 */
	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;

		for (const reg of this.services.values()) {
			if (reg.type === "singleton" && reg.singleton) {
				const value = reg.singleton;
				if (typeof value === "object" && value && "dispose" in value) {
					await (value as DIDisposable).dispose();
				}
			}
		}

		this.services.clear();
	}

	clear(): void {
		this.services.clear();
	}

	/* ───────────────────────────────── Internals ───────────────────────────── */

	private getRegistrationDeep(name: string): DIServiceRegistration<unknown, Entries> | null {
		const local = this.services.get(name);
		if (local) return local;
		return this.parent?.getRegistrationDeep(name) ?? null;
	}

	private assertAlive(): void {
		if (this.disposed) {
			throw new Error("Container has been disposed");
		}
	}

	// TODO: Enhance this for a more readable output, potentially in a future WSRT DevTools tool
	_visualizeContainers(): void {
		console.log("Container:", this);
		if (this.parent) {
			console.log("Parent:", this.parent);
		}
	}
}

/* ───────────────────────────────── Factory ───────────────────────────── */

/**
 * Factory function for creating a new container
 *
 * - This is a function that creates a new container instance
 * - It can optionally receive a parent container
 * - This is useful when you want to create a child container that inherits from a parent container
 */
export function createContainer<
	Entries extends Record<string, unknown> = Record<string, unknown>,
	ParentEntries extends Record<string, unknown> = Record<string, unknown>,
>(parent?: DIContainer<ParentEntries>) {
	return new DIContainer<Entries>(parent);
}
