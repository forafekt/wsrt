export type SpawnRequest = {
	command: string;
	args: readonly string[];
	cwd: string;
	environment: Readonly<Record<string, string>>;
	shell?: boolean;
	signal?: AbortSignal;
};
export type ProcessHandle = {
	pid: number;
	running: boolean;
	exit: Promise<{ code: number | null; signal: string | null }>;
	terminate(signal?: string): void;
};
export type ArtifactCandidate = {
	readonly path: string;
	readonly name?: string;
	readonly kind?: string;
	readonly mediaType?: string;
	readonly outputGroup?: string;
	readonly expected?: boolean;
	readonly metadata?: Readonly<Record<string, unknown>>;
};
export type ExecutionTelemetryEvent =
	| { readonly type: "execution.started"; readonly timestamp?: string }
	| {
			readonly type: "server.listening";
			readonly host: string;
			readonly port: number;
			readonly urls?: readonly string[];
	  }
	| {
			readonly type: "readiness.available";
			readonly details?: Readonly<Record<string, unknown>>;
	  }
	| {
			readonly type: "artifact.discovered";
			readonly artifact: ArtifactCandidate;
	  }
	| {
			readonly type: "diagnostic";
			readonly diagnostic: {
				readonly code: string;
				readonly severity: "info" | "warning" | "error";
				readonly message: string;
				readonly detail?: Readonly<Record<string, unknown>>;
			};
	  }
	| {
			readonly type: "custom";
			readonly namespace: string;
			readonly name: string;
			readonly payload?: unknown;
	  };
export type ProviderInvocationContext = {
	readonly pluginId: string;
	readonly contributionId: string;
	readonly nodeId: string;
	readonly operationId: string;
	readonly workspaceRoot: string;
	readonly projectRoot: string;
	readonly runtimeProviderId: string;
	readonly environment: Readonly<Record<string, string>>;
	readonly process?: ProcessHandle;
	readonly executionMetadata: Readonly<Record<string, unknown>>;
	readonly signal: AbortSignal;
	readonly capabilities: CapabilityRegistry;
	report(event: ExecutionTelemetryEvent): void;
};
export interface SpawnCapability {
	spawn(request: SpawnRequest): ProcessHandle;
}
export interface FileSystemCapability {
	readText(file: string): Promise<string>;
	writeText(file: string, contents: string): Promise<void>;
	exists(file: string): Promise<boolean>;
}
export interface EnvironmentCapability {
	all(): Readonly<Record<string, string | undefined>>;
	get(name: string): string | undefined;
}
export interface ProcessInformationCapability {
	cwd(): string;
	pid(): number;
	platform(): string;
}
export interface HttpCapability {
	fetch(input: string, init?: RequestInit): Promise<Response>;
}
export interface TimerCapability {
	delay(milliseconds: number, signal?: AbortSignal): Promise<void>;
}
export interface LoggerCapability {
	log(
		level: "debug" | "info" | "warning" | "error",
		message: string,
		attributes?: Readonly<Record<string, unknown>>,
	): void;
}
export interface NetworkCapability {
	connect(
		host: string,
		port: number,
		options?: { timeoutMs?: number; signal?: AbortSignal },
	): Promise<void>;
}
export type CapabilityMap = {
	spawn: SpawnCapability;
	filesystem: FileSystemCapability;
	environment: EnvironmentCapability;
	process: ProcessInformationCapability;
	http: HttpCapability;
	network: NetworkCapability;
	timers: TimerCapability;
	logger: LoggerCapability;
};
export class CapabilityRegistry {
	readonly #values = new Map<keyof CapabilityMap, unknown>();
	provide<K extends keyof CapabilityMap>(key: K, value: CapabilityMap[K]): this {
		this.#values.set(key, value);
		return this;
	}
	require<K extends keyof CapabilityMap>(key: K): CapabilityMap[K] {
		const value = this.#values.get(key);
		if (!value) throw new Error(`Runtime capability not available: ${key}`);
		return value as CapabilityMap[K];
	}
	has(key: keyof CapabilityMap): boolean {
		return this.#values.has(key);
	}
}
export interface RuntimeInstance {
	readonly provider: string;
	readonly capabilities: CapabilityRegistry;
	dispose(): Promise<void>;
}
export interface RuntimeProvider {
	readonly id: string;
	detect(): Promise<{ available: boolean; version?: string }>;
	create(): Promise<RuntimeInstance>;
}
export interface ExecutionAdapter<Options = unknown> {
	readonly id: string;
	validate(options: unknown): {
		options?: Options;
		diagnostics: readonly string[];
	};
	prepare(options: Options): {
		command: string;
		args: readonly string[];
		shell?: boolean;
		environment?: Readonly<Record<string, string>>;
		metadata?: Readonly<Record<string, unknown>>;
		dispose?(): void | Promise<void>;
	};
}
export interface ReadinessProvider<Options = unknown> {
	readonly id: string;
	validate(options: unknown): {
		options?: Options;
		diagnostics: readonly string[];
	};
	wait(options: Options, context: ProviderInvocationContext): Promise<void>;
}
export interface HealthProvider<Options = unknown> {
	readonly id: string;
	validate(options: unknown): {
		options?: Options;
		diagnostics: readonly string[];
	};
	check(
		options: Options,
		capabilities: CapabilityRegistry,
		signal: AbortSignal,
	): Promise<{
		healthy: boolean;
		diagnostic?: string;
		metadata?: Readonly<Record<string, unknown>>;
	}>;
}
export interface ArtifactProvider<Input = unknown> {
	readonly id: string;
	collect(input: Input, context: ProviderInvocationContext): Promise<readonly ArtifactCandidate[]>;
}
export type ProviderKind = "runtime" | "execution" | "readiness" | "health" | "artifact";
export type ProviderRegistration = {
	kind: ProviderKind;
	id: string;
	owner: string;
	provider:
		| RuntimeProvider
		| ExecutionAdapter
		| ReadinessProvider
		| HealthProvider
		| ArtifactProvider;
};
export class ProviderRegistry {
	readonly #providers = new Map<string, ProviderRegistration>();
	register(registration: ProviderRegistration): this {
		const key = `${registration.kind}:${registration.id}`;
		const existing = this.#providers.get(key);
		if (existing)
			throw new Error(
				`Duplicate ${registration.kind} provider "${registration.id}" from ${registration.owner}; already owned by ${existing.owner}`,
			);
		this.#providers.set(key, Object.freeze({ ...registration }));
		return this;
	}
	get<Provider extends ProviderRegistration["provider"]>(kind: ProviderKind, id: string): Provider {
		const registration = this.#providers.get(`${kind}:${id}`);
		if (!registration) throw new Error(`Provider not found: ${kind}:${id}`);
		return registration.provider as Provider;
	}
	list(): readonly ProviderRegistration[] {
		return [...this.#providers.values()];
	}
	clear(): void {
		this.#providers.clear();
	}
}
