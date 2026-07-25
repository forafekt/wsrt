/**
 * Dependency-free, cross-runtime event system built on the Web EventTarget API.
 *
 * Compatible with:
 * - Browsers
 * - Web Workers
 * - Service Workers
 * - Node.js
 * - Deno
 * - Bun
 * - Electron main, preload, and renderer contexts
 */

export type EventMapBase = object;

export type EventName<EventMap extends EventMapBase> = Extract<keyof EventMap, string>;

export type EventHandler<T = unknown> = (data: T, event: RuntimeEvent<T>) => void | Promise<void>;

export interface EventSubscription {
	readonly active: boolean;
	unsubscribe(): void;
}

export interface EventListenerOptions {
	/**
	 * Automatically removes the listener after its first invocation.
	 */
	once?: boolean;

	/**
	 * Automatically removes the listener when the signal is aborted.
	 */
	signal?: AbortSignal;
}

export interface EmitOptions {
	/**
	 * Throw an AggregateError after every listener has settled.
	 *
	 * Defaults to false.
	 */
	throwOnError?: boolean;
}

export interface EmitResult {
	/**
	 * Whether preventDefault() was called on a cancelable event.
	 */
	defaultPrevented: boolean;

	/**
	 * Errors produced by synchronous or asynchronous event handlers.
	 */
	errors: readonly unknown[];

	/**
	 * Number of registered EventEmitter handlers invoked.
	 *
	 * This does not include listeners registered directly through
	 * addEventListener().
	 */
	listenerCount: number;
}

export interface RuntimeEventInit {
	bubbles?: boolean;
	cancelable?: boolean;
	composed?: boolean;
}

export interface EventEmitterOptions {
	/**
	 * Listener count at which a warning should be emitted.
	 *
	 * Set to 0 or Infinity to disable warnings.
	 *
	 * Defaults to 10.
	 */
	maxListeners?: number;

	/**
	 * Optional warning handler.
	 *
	 * No console usage occurs unless this callback is supplied.
	 */
	onWarning?: (warning: EventEmitterWarning) => void;

	/**
	 * Optional listener error observer.
	 */
	onError?: (error: unknown, context: EventErrorContext) => void;
}

export interface EventEmitterWarning {
	type: "max-listeners-exceeded";
	event: string;
	listenerCount: number;
	maxListeners: number;
}

export interface EventErrorContext {
	event: string;
	handler?: EventHandler<unknown>;
}

/**
 * Event implementation carrying typed event data and async work.
 *
 * This avoids depending on CustomEvent, which has historically had less
 * consistent availability across server-side JavaScript runtimes.
 */
export class RuntimeEvent<T = unknown> extends Event {
	readonly detail: T;

	readonly #pending = new Set<Promise<void>>();
	readonly #errors: unknown[] = [];

	constructor(type: string, detail: T, init: RuntimeEventInit = {}) {
		super(type, init);
		this.detail = detail;
	}

	/**
	 * Registers asynchronous work associated with this event.
	 *
	 * This resembles ExtendableEvent.waitUntil(), but works in every
	 * EventTarget-compatible runtime.
	 */
	waitUntil(value: void | PromiseLike<void>): void {
		const promise = Promise.resolve(value)
			.catch((error: unknown) => {
				this.#errors.push(error);
			})
			.finally(() => {
				this.#pending.delete(promise);
			});

		this.#pending.add(promise);
	}

	/**
	 * Register an error produced during synchronous listener execution.
	 */
	captureError(error: unknown): void {
		this.#errors.push(error);
	}

	/**
	 * Wait for all asynchronous work registered through waitUntil().
	 */
	async settled(): Promise<readonly unknown[]> {
		while (this.#pending.size > 0) {
			await Promise.allSettled([...this.#pending]);
		}

		return [...this.#errors];
	}
}

interface ListenerRecord<T = unknown> {
	handler: EventHandler<T>;
	listener: EventListener;
	once: boolean;
	abortCleanup?: () => void;
}

class Subscription implements EventSubscription {
	#active = true;

	constructor(private readonly cleanup: () => void) {}

	get active(): boolean {
		return this.#active;
	}

	unsubscribe(): void {
		if (!this.#active) {
			return;
		}

		this.#active = false;
		this.cleanup();
	}
}

/**
 * Typed EventTarget-based event emitter.
 *
 * EventMap example:
 *
 * interface ApplicationEvents {
 *   ready: undefined
 *   error: { error: unknown }
 *   serviceStarted: { name: string; port: number }
 * }
 */
export class EventEmitter<
	EventMap extends EventMapBase = Record<string, unknown>,
> extends EventTarget {
	readonly #listeners = new Map<string, Map<EventHandler<unknown>, ListenerRecord<unknown>>>();

	readonly #warningIssued = new Set<string>();

	#maxListeners: number;
	#onWarning?: EventEmitterOptions["onWarning"];
	#onError?: EventEmitterOptions["onError"];

	constructor(options: EventEmitterOptions = {}) {
		super();

		this.#maxListeners = options.maxListeners ?? 10;
		this.#onWarning = options.onWarning;
		this.#onError = options.onError;
	}

	/**
	 * Subscribe to an event.
	 *
	 * Returns a subscription object for convenient cleanup.
	 */
	on<K extends EventName<EventMap>>(
		event: K,
		handler: EventHandler<EventMap[K]>,
		options: EventListenerOptions = {},
	): EventSubscription {
		const eventName = String(event);

		if (options.signal?.aborted) {
			return new Subscription(() => undefined);
		}

		let eventListeners = this.#listeners.get(eventName);

		if (!eventListeners) {
			eventListeners = new Map();
			this.#listeners.set(eventName, eventListeners);
		}

		const untypedHandler = handler as EventHandler<unknown>;
		const existing = eventListeners.get(untypedHandler);

		// Match native EventTarget behavior: the same callback is not added twice
		// for the same event type.
		if (existing) {
			return new Subscription(() => {
				this.off(event, handler);
			});
		}

		const record: ListenerRecord<unknown> = {
			handler: untypedHandler,
			once: options.once ?? false,
			listener: () => undefined,
		};

		record.listener = (nativeEvent: Event): void => {
			const runtimeEvent = nativeEvent as RuntimeEvent<unknown>;

			// Remove before execution so recursive emit() calls do not invoke a
			// once-listener again.
			if (record.once) {
				this.#removeRecord(eventName, record);
			}

			try {
				const result = record.handler(runtimeEvent.detail, runtimeEvent);
				runtimeEvent.waitUntil(result);
			} catch (error: unknown) {
				runtimeEvent.captureError(error);
				this.#reportError(error, eventName, record.handler);
			}
		};

		eventListeners.set(untypedHandler, record);
		super.addEventListener(eventName, record.listener);

		if (options.signal) {
			const abort = (): void => {
				this.#removeRecord(eventName, record);
			};

			options.signal.addEventListener("abort", abort, { once: true });

			record.abortCleanup = () => {
				options.signal?.removeEventListener("abort", abort);
			};
		}

		this.#checkListenerLimit(eventName, eventListeners.size);

		return new Subscription(() => {
			this.off(event, handler);
		});
	}

	/**
	 * Subscribe to an event for one invocation.
	 */
	once<K extends EventName<EventMap>>(
		event: K,
		handler: EventHandler<EventMap[K]>,
		options: Omit<EventListenerOptions, "once"> = {},
	): EventSubscription {
		return this.on(event, handler, {
			...options,
			once: true,
		});
	}

	/**
	 * Unsubscribe a handler.
	 */
	off<K extends EventName<EventMap>>(event: K, handler: EventHandler<EventMap[K]>): void {
		const eventName = String(event);
		const eventListeners = this.#listeners.get(eventName);

		if (!eventListeners) {
			return;
		}

		const record = eventListeners.get(handler as EventHandler<unknown>);

		if (!record) {
			return;
		}

		this.#removeRecord(eventName, record);
	}

	/**
	 * Emit an event and wait for all registered async handlers.
	 *
	 * Unlike native dispatchEvent(), this method waits for promises returned
	 * by handlers registered through on() or once().
	 */
	async emit<K extends EventName<EventMap>>(
		event: K,
		data: EventMap[K],
		options: EmitOptions = {},
	): Promise<EmitResult> {
		const eventName = String(event);
		const listenerCount = this.listenerCount(event);
		const runtimeEvent = new RuntimeEvent(eventName, data, {
			cancelable: true,
		});

		super.dispatchEvent(runtimeEvent);

		const errors = await runtimeEvent.settled();

		for (const error of errors) {
			this.#reportError(error, eventName);
		}

		if (options.throwOnError && errors.length > 0) {
			throw new AggregateError(errors, `One or more handlers failed for event "${eventName}".`);
		}

		return {
			defaultPrevented: runtimeEvent.defaultPrevented,
			errors,
			listenerCount,
		};
	}

	/**
	 * Emit without waiting for asynchronous handlers.
	 *
	 * This is useful for native EventTarget-style fire-and-forget dispatch.
	 */
	emitSync<K extends EventName<EventMap>>(event: K, data: EventMap[K]): RuntimeEvent<EventMap[K]> {
		const runtimeEvent = new RuntimeEvent(String(event), data, {
			cancelable: true,
		});

		super.dispatchEvent(runtimeEvent);

		// Prevent unhandled rejections while preserving fire-and-forget behavior.
		void runtimeEvent.settled().then((errors) => {
			for (const error of errors) {
				this.#reportError(error, String(event));
			}
		});

		return runtimeEvent;
	}

	/**
	 * Remove all managed listeners for one event or every event.
	 *
	 * This only removes listeners registered through on() or once().
	 * Native listeners added directly through addEventListener() remain under
	 * the ownership of the caller that registered them.
	 */
	removeAllListeners<K extends EventName<EventMap>>(event?: K): void {
		if (event !== undefined) {
			this.#removeEventListeners(String(event));
			return;
		}

		for (const eventName of [...this.#listeners.keys()]) {
			this.#removeEventListeners(eventName);
		}
	}

	/**
	 * Return the number of managed listeners for an event.
	 */
	listenerCount<K extends EventName<EventMap>>(event: K): number {
		return this.#listeners.get(String(event))?.size ?? 0;
	}

	/**
	 * Return event names that currently have managed listeners.
	 */
	eventNames(): Array<EventName<EventMap>> {
		return [...this.#listeners.keys()] as Array<EventName<EventMap>>;
	}

	/**
	 * Return the original handlers registered for an event.
	 */
	listeners<K extends EventName<EventMap>>(event: K): Array<EventHandler<EventMap[K]>> {
		const records = this.#listeners.get(String(event));

		if (!records) {
			return [];
		}

		return [...records.values()].map((record) => record.handler as EventHandler<EventMap[K]>);
	}

	/**
	 * Set the listener warning threshold.
	 *
	 * A value of 0 or Infinity disables warnings.
	 */
	setMaxListeners(maxListeners: number): this {
		if (Number.isNaN(maxListeners) || maxListeners < 0) {
			throw new RangeError("maxListeners must be a non-negative number.");
		}

		this.#maxListeners = maxListeners;
		this.#warningIssued.clear();

		return this;
	}

	getMaxListeners(): number {
		return this.#maxListeners;
	}

	setWarningHandler(handler: EventEmitterOptions["onWarning"]): this {
		this.#onWarning = handler;
		return this;
	}

	setErrorHandler(handler: EventEmitterOptions["onError"]): this {
		this.#onError = handler;
		return this;
	}

	/**
	 * Node EventEmitter-compatible alias.
	 */
	addListener<K extends EventName<EventMap>>(
		event: K,
		handler: EventHandler<EventMap[K]>,
		options?: EventListenerOptions,
	): EventSubscription {
		return this.on(event, handler, options);
	}

	/**
	 * Node EventEmitter-compatible alias.
	 */
	removeListener<K extends EventName<EventMap>>(
		event: K,
		handler: EventHandler<EventMap[K]>,
	): void {
		this.off(event, handler);
	}

	#removeRecord(eventName: string, record: ListenerRecord<unknown>): void {
		const eventListeners = this.#listeners.get(eventName);

		if (!eventListeners) {
			return;
		}

		super.removeEventListener(eventName, record.listener);
		record.abortCleanup?.();

		eventListeners.delete(record.handler);

		if (eventListeners.size === 0) {
			this.#listeners.delete(eventName);
			this.#warningIssued.delete(eventName);
		}
	}

	#removeEventListeners(eventName: string): void {
		const eventListeners = this.#listeners.get(eventName);

		if (!eventListeners) {
			return;
		}

		for (const record of [...eventListeners.values()]) {
			this.#removeRecord(eventName, record);
		}
	}

	#checkListenerLimit(eventName: string, listenerCount: number): void {
		if (
			!this.#onWarning ||
			this.#maxListeners === 0 ||
			this.#maxListeners === Infinity ||
			listenerCount <= this.#maxListeners ||
			this.#warningIssued.has(eventName)
		) {
			return;
		}

		this.#warningIssued.add(eventName);

		this.#onWarning({
			type: "max-listeners-exceeded",
			event: eventName,
			listenerCount,
			maxListeners: this.#maxListeners,
		});
	}

	#reportError(error: unknown, event: string, handler?: EventHandler<unknown>): void {
		this.#onError?.(error, {
			event,
			handler,
		});
	}
}

/**
 * Create an untyped event emitter.
 */
export function createEventEmitter(options?: EventEmitterOptions): EventEmitter {
	return new EventEmitter(options);
}

/**
 * Create a typed event emitter.
 */
export function createTypedEventEmitter<EventMap extends EventMapBase>(
	options?: EventEmitterOptions,
): EventEmitter<EventMap> {
	return new EventEmitter<EventMap>(options);
}

/**
 * Shared application-wide event bus.
 *
 * For larger systems, dependency injection is usually preferable to accessing
 * this singleton directly. The singleton remains useful at application
 * boundaries and for backwards compatibility.
 */
export class EventBus {
	static #instance: EventEmitter<Record<string, unknown>> | undefined;

	static getInstance(): EventEmitter<Record<string, unknown>> {
		EventBus.#instance ??= createEventEmitter();
		return EventBus.#instance;
	}

	static reset(): void {
		EventBus.#instance?.removeAllListeners();
		EventBus.#instance = createEventEmitter();
	}

	static setInstance(instance: EventEmitter<Record<string, unknown>>): void {
		EventBus.#instance?.removeAllListeners();
		EventBus.#instance = instance;
	}
}

/**
 * Backwards-compatible alias.
 *
 * @deprecated Prefer EventEmitter.
 */
export class SimpleEventEmitter<
	EventMap extends EventMapBase = Record<string, unknown>,
> extends EventEmitter<EventMap> {}

// Typed usage
// interface RuntimeEvents {
//   ready: undefined

//   error: {
//     error: unknown
//     source?: string
//   }

//   serviceStarted: {
//     name: string
//     port: number
//   }

//   serviceStopped: {
//     name: string
//     exitCode?: number
//   }
// }

// const events = createTypedEventEmitter<RuntimeEvents>({
//   maxListeners: 20,

//   onWarning(warning) {
//     console.warn(
//       `${warning.listenerCount} listeners registered for "${warning.event}".`,
//     )
//   },

//   onError(error, context) {
//     console.error(
//       `Event handler failed for "${context.event}".`,
//       error,
//     )
//   },
// })

// const subscription = events.on(
//   'serviceStarted',
//   async ({ name, port }, event) => {
//     console.log(`${name} started on port ${port}`)

//     // The handler's returned promise is automatically awaited.
//     await persistServiceState(name, port)

//     // Handlers may also explicitly register additional async work.
//     event.waitUntil(reportServiceStarted(name))
//   },
// )

// await events.emit('serviceStarted', {
//   name: 'dashboard',
//   port: 5177,
// })

// subscription.unsubscribe()
// AbortSignal-based cleanup

// This is especially useful for services, plugins, components, and runtime scopes:

// const controller = new AbortController()

// events.on(
//   'error',
//   ({ error }) => {
//     console.error(error)
//   },
//   {
//     signal: controller.signal,
//   },
// )

// // Automatically removes every listener using this signal.
// controller.abort()
// Native EventTarget interoperability

// Because the class genuinely extends EventTarget, normal Web API listeners also work:

// events.addEventListener('serviceStarted', (event) => {
//   const runtimeEvent = event as RuntimeEvent<
//     RuntimeEvents['serviceStarted']
//   >

//   console.log(runtimeEvent.detail.name)
// })

// The main deliberate differences from your original implementation are:

// EventEmitter now genuinely is an EventTarget.
// CustomEvent is avoided for stronger server-runtime compatibility.
// No direct console calls exist in the core implementation.
// Async handlers are awaited through RuntimeEvent.waitUntil().
// Listener errors are collected rather than silently swallowed.
// AbortSignal provides lifecycle-oriented cleanup.
// on() returns an unsubscribe subscription.
// The separate TypedEventEmitter wrapper is unnecessary because the main class is already typed.
// The global EventBus remains available, but ordinary dependency injection can use EventEmitter<EventMap> directly.
