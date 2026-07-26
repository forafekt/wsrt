import path from "node:path";
import { type DependencyCondition, SystemGraph } from "@wsrt/graph";

export type SourceReference = {
	file: string;
	path: string;
	line?: number;
	column?: number;
};

export type SystemDiagnostic = {
	code: string;
	severity: "info" | "warning" | "error";
	message: string;
	source: SourceReference;
	suggestion?: string;
};

export type CommandInput = string | { command: string; args?: string[]; shell?: boolean };

export type HealthcheckInput =
	| { type: "process"; unhealthyThreshold?: number; healthyThreshold?: number }
	| {
			type: "http";
			url: string;
			intervalMs?: number;
			timeoutMs?: number;
			retries?: number;
			unhealthyThreshold?: number;
			healthyThreshold?: number;
	  }
	| {
			type: "tcp";
			host?: string;
			port: number;
			intervalMs?: number;
			timeoutMs?: number;
			retries?: number;
			unhealthyThreshold?: number;
			healthyThreshold?: number;
	  };

export type RestartPolicyInput =
	| { policy: "never" }
	| {
			policy: "on-failure" | "always";
			attempts?: number;
			delayMs?: number;
			backoff?: "fixed" | "exponential";
			maximumDelayMs?: number;
			restartOnUnhealthy?: boolean;
	  };

export type TaskOutputInput = {
	artifact: string;
	path: string;
	type?: string;
	directory?: boolean;
};

export type ExecutableInput = {
	root?: string;
	runtime?: string;
	command?: CommandInput;
	dependsOn?: Record<string, { condition?: DependencyCondition }> | string[];
	healthcheck?: HealthcheckInput;
	restart?: RestartPolicyInput;
	critical?: boolean;
	environment?: Record<string, string>;
	provider?: { provider: string; options?: unknown };
	/** Execution adapter contribution id (for example `vite`). */
	adapter?: string;
};

export type ApplicationInput = ExecutableInput & {
	processes?: Record<string, ExecutableInput>;
	consumes?: string[];
};

export type TaskInput = ExecutableInput & {
	produces?: string[];
	outputs?: TaskOutputInput[];
};

export type ArtifactInput = {
	type: string;
	producer?: string;
	consumers?: readonly string[];
	location?: string;
	metadata?: Readonly<Record<string, unknown>>;
};

export type EnvironmentInput = {
	activate?: { applications?: string[]; services?: string[]; tasks?: string[] };
};

export type PluginObjectInput = {
	readonly id: string;
	readonly version: string;
	readonly [key: string]: unknown;
};

export type WorkspaceDefinitionInput = {
	$schema?: string;
	schemaVersion?: "1";
	name: string;
	workspace?: { root?: string; packageManager?: string } | null;
	runtimes?: Record<string, { provider: string; version?: string; options?: unknown }> | null;
	applications?: Record<string, ApplicationInput> | null;
	services?: Record<string, ExecutableInput> | null;
	tasks?: Record<string, TaskInput> | null;
	artifacts?: Record<string, ArtifactInput> | null;
	environments?: Record<string, EnvironmentInput> | null;
	plugins?: Array<string | { provider: string; options?: unknown } | PluginObjectInput> | null;
	persistence?:
		| false
		| null
		| {
				provider?: "filesystem";
				root?: string;
				journals?: {
					maxFileSizeBytes?: number;
					maxFiles?: number;
					flushIntervalMs?: number;
				};
		  };
};

export type NormalizedCommand = {
	command: string;
	args: readonly string[];
	shell: boolean;
};

export type NormalizedExecutable = {
	id: string;
	name: string;
	kind: "application" | "service" | "process" | "task";
	root: string;
	runtime: string;
	command?: NormalizedCommand;
	provider?: { provider: string; options?: unknown };
	dependencies: readonly { id: string; condition: DependencyCondition }[];
	healthcheck?: HealthcheckInput;
	restart: RestartPolicyInput;
	critical: boolean;
	outputs: readonly TaskOutputInput[];
	environment: Readonly<Record<string, string>>;
	source: SourceReference;
};

export type NormalizedArtifact = ArtifactInput & {
	id: string;
	name: string;
	consumers: readonly string[];
	metadata: Readonly<Record<string, unknown>>;
	source: SourceReference;
};

export type NormalizedSystemDefinition = {
	schemaVersion: "1";
	name: string;
	root: string;
	workspace: { packageManager?: string };
	runtimes: Readonly<Record<string, { provider: string; version?: string; options?: unknown }>>;
	executables: readonly NormalizedExecutable[];
	artifacts: readonly NormalizedArtifact[];
	environments: Readonly<Record<string, EnvironmentInput>>;
	plugins: readonly (string | { provider: string; options?: unknown } | PluginObjectInput)[];
	persistence:
		| false
		| {
				provider: "filesystem";
				root: string;
				journals: {
					maxFileSizeBytes: number;
					maxFiles: number;
					flushIntervalMs: number;
				};
		  };
	sourceFile: string;
};

export const WSRT_CONFIG_SCHEMA_URL = "https://unpkg.com/@wsrt/config/schema/wsrt.schema.json";

const publicConfigTemplate = Object.freeze({
	$schema: WSRT_CONFIG_SCHEMA_URL,
	schemaVersion: "1" as const,
	name: "workspace",
	workspace: {},
	runtimes: {},
	applications: {},
	services: {},
	tasks: {},
	artifacts: {},
	environments: {},
	plugins: [],
	persistence: {},
});

export const publicConfigSections = Object.freeze(Object.keys(publicConfigTemplate));

const coreKeys = new Set<string>(publicConfigSections);

/** Creates the discoverable starter from the same section metadata used by validation. */
export function createSystemTemplate(name = "workspace"): WorkspaceDefinitionInput {
	return { ...structuredClone(publicConfigTemplate), name };
}

export function createNullishSystemTemplate(name = "workspace"): WorkspaceDefinitionInput {
	return Object.fromEntries(
		Object.keys(publicConfigTemplate).map((key) => [
			key,
			key === "$schema"
				? publicConfigTemplate.$schema
				: key === "schemaVersion"
					? "1"
					: key === "name"
						? name
						: null,
		]),
	) as unknown as WorkspaceDefinitionInput;
}

export function defineSystem(input: WorkspaceDefinitionInput): WorkspaceDefinitionInput {
	return input;
}

export function normalizeSystemDefinition(
	input: WorkspaceDefinitionInput,
	options: { root: string; file: string },
): {
	definition?: NormalizedSystemDefinition;
	diagnostics: SystemDiagnostic[];
} {
	const diagnostics: SystemDiagnostic[] = [];
	diagnostics.push(...validateInputShape(input, options.file));
	for (const key of Object.keys(input))
		if (!coreKeys.has(key))
			diagnostics.push({
				code: "config.unknown_property",
				severity: "error",
				message: `Unknown core property "${key}"`,
				source: { file: options.file, path: key },
				suggestion: "Remove it or put provider-specific data under provider options.",
			});
	if (!input.name)
		diagnostics.push({
			code: "config.name_required",
			severity: "error",
			message: "System name is required",
			source: { file: options.file, path: "name" },
		});
	if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) return { diagnostics };
	const root = path.resolve(options.root, input.workspace?.root ?? "."),
		executables: NormalizedExecutable[] = [];
	const add = (
		kind: NormalizedExecutable["kind"],
		name: string,
		value: ExecutableInput,
		prefix: string = kind,
	) => {
		const id = `${prefix}:${name}`;
		executables.push({
			id,
			name,
			kind,
			root: path.resolve(root, value.root ?? "."),
			runtime: value.runtime ?? "node",
			command: command(value.command),
			provider: value.provider ?? (value.adapter ? { provider: value.adapter } : undefined),
			dependencies: dependencies(value.dependsOn),
			healthcheck: value.healthcheck,
			restart: value.restart ?? { policy: "never" },
			critical: value.critical ?? true,
			outputs: Object.freeze([...(kind === "task" ? ((value as TaskInput).outputs ?? []) : [])]),
			environment: Object.freeze({ ...value.environment }),
			source: { file: options.file, path: `${kind}s.${name}` },
		});
		return id;
	};
	for (const [name, value] of Object.entries(input.applications ?? {})) {
		const app = add("application", name, value);
		for (const [child, item] of Object.entries(value.processes ?? {}))
			add("process", child, item, `${app}/process`);
	}
	for (const [name, value] of Object.entries(input.services ?? {})) add("service", name, value);
	for (const [name, value] of Object.entries(input.tasks ?? {})) add("task", name, value);
	const artifacts: NormalizedArtifact[] = Object.entries(input.artifacts ?? {}).map(
		([name, value]) => ({
			...value,
			id: `artifact:${name}`,
			name,
			consumers: Object.freeze([...(value.consumers ?? [])]),
			metadata: Object.freeze({ ...value.metadata }),
			source: { file: options.file, path: `artifacts.${name}` },
		}),
	);
	const definition: NormalizedSystemDefinition = {
		schemaVersion: input.schemaVersion ?? "1",
		name: input.name,
		root,
		workspace: { packageManager: input.workspace?.packageManager },
		runtimes: Object.freeze({ node: { provider: "node" }, ...input.runtimes }),
		executables: Object.freeze(executables),
		artifacts: Object.freeze(artifacts),
		environments: Object.freeze({ ...input.environments }),
		plugins: Object.freeze([...(input.plugins ?? [])]),
		persistence:
			input.persistence === false
				? false
				: Object.freeze({
						provider: input.persistence?.provider ?? "filesystem",
						root: input.persistence?.root ?? ".wsrt",
						journals: Object.freeze({
							maxFileSizeBytes: input.persistence?.journals?.maxFileSizeBytes ?? 20 * 1024 * 1024,
							maxFiles: input.persistence?.journals?.maxFiles ?? 5,
							flushIntervalMs: input.persistence?.journals?.flushIntervalMs ?? 250,
						}),
					}),
		sourceFile: options.file,
	};
	diagnostics.push(...references(definition));
	return diagnostics.some((d) => d.severity === "error")
		? { diagnostics }
		: { definition: Object.freeze(definition), diagnostics };
}

function validateInputShape(input: WorkspaceDefinitionInput, file: string): SystemDiagnostic[] {
	const diagnostics: SystemDiagnostic[] = [];
	const error = (configPath: string, message: string) =>
		diagnostics.push({
			code: "config.invalid_type",
			severity: "error",
			message,
			source: { file, path: configPath },
		});
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		error("", "Configuration must be an object");
		return diagnostics;
	}
	if (input.name !== undefined && (typeof input.name !== "string" || !input.name))
		error("name", "System name must be a non-empty string");
	if (input.schemaVersion !== undefined && input.schemaVersion !== "1")
		error("schemaVersion", 'Schema version must be "1"');
	for (const key of [
		"workspace",
		"runtimes",
		"applications",
		"services",
		"tasks",
		"artifacts",
		"environments",
	] as const) {
		const value = input[key];
		if (
			value !== undefined &&
			value !== null &&
			(!value || typeof value !== "object" || Array.isArray(value))
		)
			error(key, `${key} must be an object or null`);
	}
	if (input.plugins !== undefined && input.plugins !== null && !Array.isArray(input.plugins))
		error("plugins", "plugins must be an array or null");
	for (const [name, value] of Object.entries(input.runtimes ?? {})) {
		const base = `runtimes.${name}`;
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			error(base, "Runtime definition must be an object");
			continue;
		}
		if (typeof value.provider !== "string" || !value.provider)
			error(`${base}.provider`, "Runtime provider must be a non-empty string");
	}
	const executableGroups = [
		["applications", input.applications],
		["services", input.services],
		["tasks", input.tasks],
	] as const;
	for (const [group, values] of executableGroups)
		for (const [name, value] of Object.entries(values ?? {})) {
			const base = `${group}.${name}`;
			if (!value || typeof value !== "object" || Array.isArray(value)) {
				error(base, "Executable definition must be an object");
				continue;
			}
			if (
				value.command &&
				typeof value.command === "object" &&
				(typeof value.command.command !== "string" || !value.command.command)
			)
				error(`${base}.command.command`, "Command must be a non-empty string");
			if (value.restart) {
				if (!["never", "on-failure", "always"].includes(value.restart.policy))
					error(`${base}.restart.policy`, "Expected never, on-failure, or always");
				if (
					"backoff" in value.restart &&
					value.restart.backoff !== undefined &&
					!["fixed", "exponential"].includes(value.restart.backoff)
				)
					error(`${base}.restart.backoff`, "Expected fixed or exponential");
			}
			if (value.healthcheck && !["process", "http", "tcp"].includes(value.healthcheck.type))
				error(`${base}.healthcheck.type`, "Expected process, http, or tcp");
		}
	return diagnostics;
}

function command(value?: CommandInput): NormalizedCommand | undefined {
	if (!value) return;
	if (typeof value === "string") return { command: value, args: [], shell: true };
	return {
		command: value.command,
		args: Object.freeze([...(value.args ?? [])]),
		shell: value.shell ?? false,
	};
}

function dependencies(
	value?: ExecutableInput["dependsOn"],
): { id: string; condition: DependencyCondition }[] {
	if (!value) return [];
	if (Array.isArray(value)) return value.map((id) => ({ id, condition: "started" }));
	return Object.entries(value).map(([id, item]) => ({
		id,
		condition: item.condition ?? "started",
	}));
}

function references(definition: NormalizedSystemDefinition): SystemDiagnostic[] {
	const result: SystemDiagnostic[] = [],
		names = new Set(definition.executables.map((e) => e.name));
	const push = (code: string, message: string, source: SourceReference, path: string) =>
		result.push({
			code,
			severity: "error",
			message,
			source: { ...source, path },
		});
	for (const item of definition.executables) {
		if (!definition.runtimes[item.runtime])
			push(
				"config.runtime_missing",
				`Unknown runtime "${item.runtime}"`,
				item.source,
				`${item.source.path}.runtime`,
			);
		for (const dep of item.dependencies)
			if (!names.has(dep.id))
				push(
					"config.dependency_missing",
					`Unknown dependency "${dep.id}"`,
					item.source,
					`${item.source.path}.dependsOn.${dep.id}`,
				);
		if (item.kind === "task") {
			const seen = new Set<string>();
			for (const [index, output] of item.outputs.entries()) {
				const artifact = definition.artifacts.find(
					(candidate) => candidate.name === output.artifact,
				);
				if (!artifact)
					push(
						"WSRT_ARTIFACT_OUTPUT_MISSING",
						`Unknown output artifact "${output.artifact}"`,
						item.source,
						`${item.source.path}.outputs.${index}.artifact`,
					);
				else if (artifact.producer !== item.name)
					push(
						"WSRT_ARTIFACT_PRODUCER_MISMATCH",
						`Artifact "${output.artifact}" is produced by "${artifact.producer ?? "nobody"}", not "${item.name}"`,
						item.source,
						`${item.source.path}.outputs.${index}.artifact`,
					);
				if (seen.has(output.artifact))
					push(
						"config.artifact_output_duplicate",
						`Duplicate output artifact "${output.artifact}"`,
						item.source,
						`${item.source.path}.outputs.${index}`,
					);
				seen.add(output.artifact);
				const resolved = path.resolve(item.root, output.path);
				if (resolved !== definition.root && !resolved.startsWith(`${definition.root}${path.sep}`))
					push(
						"WSRT_ARTIFACT_PATH_INVALID",
						`Output path escapes workspace: ${output.path}`,
						item.source,
						`${item.source.path}.outputs.${index}.path`,
					);
			}
		}
	}
	for (const item of definition.artifacts) {
		if (item.producer && !names.has(item.producer))
			push(
				"config.artifact_producer_missing",
				`Unknown producer "${item.producer}"`,
				item.source,
				`${item.source.path}.producer`,
			);
		for (const consumer of item.consumers)
			if (!names.has(consumer))
				push(
					"config.artifact_consumer_missing",
					`Unknown consumer "${consumer}"`,
					item.source,
					`${item.source.path}.consumers`,
				);
	}
	return result;
}

export function compileSystemGraph(definition: NormalizedSystemDefinition): SystemGraph {
	const graph = new SystemGraph(),
		workspace = `workspace:${definition.name}`,
		ids = new Map<string, string>();
	graph.addNode({ id: workspace, name: definition.name, kind: "workspace" });
	for (const item of definition.executables) {
		ids.set(item.name, item.id);
		graph.addNode({
			id: item.id,
			name: item.name,
			kind: item.kind,
			metadata: {
				root: item.root,
				runtime: item.runtime,
				provider: item.provider?.provider,
			},
		});
		const owner = item.id.includes("/process:")
			? item.id.slice(0, item.id.indexOf("/process:"))
			: workspace;
		graph.addEdge({ from: owner, to: item.id, kind: "contains" });
	}
	for (const item of definition.executables)
		for (const dep of item.dependencies)
			graph.addEdge({
				from: item.id,
				to: ids.get(dep.id) ?? dep.id,
				kind: "depends-on",
				condition: dep.condition,
			});
	for (const item of definition.artifacts) {
		graph.addNode({
			id: item.id,
			name: item.name,
			kind: "artifact",
			metadata: { type: item.type, location: item.location },
		});
		graph.addEdge({ from: workspace, to: item.id, kind: "contains" });
		if (item.producer)
			graph.addEdge({
				from: ids.get(item.producer) ?? item.producer,
				to: item.id,
				kind: "produces",
			});
		for (const consumer of item.consumers)
			graph.addEdge({
				from: ids.get(consumer) ?? consumer,
				to: item.id,
				kind: "consumes",
			});
	}
	for (const [name, value] of Object.entries(definition.environments)) {
		const id = `environment:${name}`;
		graph.addNode({ id, name, kind: "environment" });
		graph.addEdge({ from: workspace, to: id, kind: "contains" });
		for (const target of [
			...(value.activate?.applications ?? []),
			...(value.activate?.services ?? []),
			...(value.activate?.tasks ?? []),
		])
			graph.addEdge({
				from: id,
				to: ids.get(target) ?? target,
				kind: "activates",
			});
	}
	return graph;
}
