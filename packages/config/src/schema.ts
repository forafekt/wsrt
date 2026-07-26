import { publicConfigSections, WSRT_CONFIG_SCHEMA_URL } from "./system.js";

export type JsonSchema = Readonly<Record<string, unknown>>;

export const wsrtConfigSchemaId = WSRT_CONFIG_SCHEMA_URL;

const nullable = (schema: Record<string, unknown>) => ({
	anyOf: [schema, { type: "null" }],
});
const record = (reference: string) => ({
	type: "object",
	additionalProperties: { $ref: reference },
});

/** Generates the public artifact deterministically from WSRT configuration metadata. */
export function generateWsrtConfigJsonSchema(): JsonSchema {
	const executableProperties = {
		root: { type: "string", description: "Working directory relative to the workspace." },
		runtime: { type: "string", description: "Configured runtime identifier." },
		command: {
			anyOf: [
				{ type: "string" },
				{
					type: "object",
					required: ["command"],
					properties: {
						command: { type: "string" },
						args: { type: "array", items: { type: "string" } },
						shell: { type: "boolean" },
					},
					additionalProperties: false,
				},
			],
		},
		dependsOn: {
			anyOf: [
				{ type: "array", items: { type: "string" } },
				{
					type: "object",
					additionalProperties: {
						type: "object",
						properties: {
							condition: {
								enum: ["started", "ready", "healthy", "completed", "successful"],
							},
						},
						additionalProperties: false,
					},
				},
			],
		},
		healthcheck: { $ref: "#/$defs/healthcheck" },
		restart: { $ref: "#/$defs/restart" },
		critical: { type: "boolean", default: true },
		environment: { type: "object", additionalProperties: { type: "string" } },
		provider: {
			type: "object",
			required: ["provider"],
			properties: { provider: { type: "string" }, options: {} },
			additionalProperties: false,
		},
		adapter: { type: "string", deprecated: true },
	};
	const schema = {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		$id: wsrtConfigSchemaId,
		title: "WSRT Configuration",
		description: "Configuration schema for WSRT workspaces.",
		type: "object",
		required: ["name"],
		properties: {
			$schema: {
				type: "string",
				description: "Editor schema association; ignored during normalization.",
			},
			schemaVersion: {
				const: "1",
				default: "1",
				description: "WSRT public configuration schema version.",
			},
			name: { type: "string", minLength: 1, description: "Workspace system name." },
			workspace: nullable({
				type: "object",
				properties: {
					root: { type: "string", default: "." },
					packageManager: { type: "string" },
				},
				additionalProperties: false,
			}),
			runtimes: nullable(record("#/$defs/runtime")),
			applications: nullable(record("#/$defs/application")),
			services: nullable(record("#/$defs/executable")),
			tasks: nullable(record("#/$defs/task")),
			artifacts: nullable(record("#/$defs/artifact")),
			environments: nullable(record("#/$defs/environment")),
			plugins: nullable({
				type: "array",
				items: {
					anyOf: [
						{ type: "string" },
						{
							type: "object",
							required: ["provider"],
							properties: { provider: { type: "string" }, options: {} },
							additionalProperties: true,
						},
						{
							type: "object",
							required: ["id", "version"],
							properties: { id: { type: "string" }, version: { type: "string" } },
							additionalProperties: true,
						},
					],
				},
			}),
			persistence: {
				anyOf: [
					{ type: "null" },
					{ const: false },
					{
						type: "object",
						properties: {
							provider: { const: "filesystem", default: "filesystem" },
							root: { type: "string", default: ".wsrt" },
							journals: {
								type: "object",
								properties: {
									maxFileSizeBytes: { type: "integer", minimum: 1 },
									maxFiles: { type: "integer", minimum: 1 },
									flushIntervalMs: { type: "integer", minimum: 0 },
								},
								additionalProperties: false,
							},
						},
						additionalProperties: false,
					},
				],
			},
		},
		additionalProperties: false,
		$defs: {
			runtime: {
				type: "object",
				required: ["provider"],
				properties: {
					provider: { type: "string" },
					version: { type: "string" },
					options: {},
				},
				additionalProperties: false,
			},
			executable: {
				type: "object",
				properties: executableProperties,
				additionalProperties: false,
			},
			application: {
				type: "object",
				properties: {
					...executableProperties,
					processes: record("#/$defs/executable"),
					consumes: { type: "array", items: { type: "string" } },
				},
				additionalProperties: false,
			},
			task: {
				type: "object",
				properties: {
					...executableProperties,
					produces: { type: "array", items: { type: "string" } },
					outputs: {
						type: "array",
						items: {
							type: "object",
							required: ["artifact", "path"],
							properties: {
								artifact: { type: "string" },
								path: { type: "string" },
								type: { type: "string" },
								directory: { type: "boolean" },
							},
							additionalProperties: false,
						},
					},
				},
				additionalProperties: false,
			},
			healthcheck: {
				oneOf: [
					{
						type: "object",
						required: ["type"],
						properties: {
							type: { const: "process" },
							unhealthyThreshold: { type: "integer", minimum: 1 },
							healthyThreshold: { type: "integer", minimum: 1 },
						},
						additionalProperties: false,
					},
					{
						type: "object",
						required: ["type", "url"],
						properties: {
							type: { const: "http" },
							url: { type: "string", format: "uri" },
							intervalMs: { type: "integer", minimum: 0 },
							timeoutMs: { type: "integer", minimum: 0 },
							retries: { type: "integer", minimum: 0 },
							unhealthyThreshold: { type: "integer", minimum: 1 },
							healthyThreshold: { type: "integer", minimum: 1 },
						},
						additionalProperties: false,
					},
					{
						type: "object",
						required: ["type", "port"],
						properties: {
							type: { const: "tcp" },
							host: { type: "string" },
							port: { type: "integer", minimum: 1, maximum: 65535 },
							intervalMs: { type: "integer", minimum: 0 },
							timeoutMs: { type: "integer", minimum: 0 },
							retries: { type: "integer", minimum: 0 },
							unhealthyThreshold: { type: "integer", minimum: 1 },
							healthyThreshold: { type: "integer", minimum: 1 },
						},
						additionalProperties: false,
					},
				],
			},
			restart: {
				oneOf: [
					{
						type: "object",
						required: ["policy"],
						properties: { policy: { const: "never" } },
						additionalProperties: false,
					},
					{
						type: "object",
						required: ["policy"],
						properties: {
							policy: { enum: ["on-failure", "always"] },
							attempts: { type: "integer", minimum: 0 },
							delayMs: { type: "integer", minimum: 0 },
							backoff: { enum: ["fixed", "exponential"] },
							maximumDelayMs: { type: "integer", minimum: 0 },
							restartOnUnhealthy: { type: "boolean" },
						},
						additionalProperties: false,
					},
				],
			},
			artifact: {
				type: "object",
				required: ["type"],
				properties: {
					type: { type: "string" },
					producer: { type: "string" },
					consumers: { type: "array", items: { type: "string" } },
					location: { type: "string" },
					metadata: { type: "object" },
				},
				additionalProperties: false,
			},
			environment: {
				type: "object",
				properties: {
					activate: {
						type: "object",
						properties: {
							applications: { type: "array", items: { type: "string" } },
							services: { type: "array", items: { type: "string" } },
							tasks: { type: "array", items: { type: "string" } },
						},
						additionalProperties: false,
					},
				},
				additionalProperties: false,
			},
		},
	};
	const properties = schema.properties as Record<string, unknown>;
	return {
		...schema,
		properties: Object.fromEntries(
			publicConfigSections.map((section) => [section, properties[section]]),
		),
	};
}

export function serializeWsrtConfigJsonSchema(
	schema: JsonSchema = generateWsrtConfigJsonSchema(),
): string {
	return `${JSON.stringify(schema, null, 2)}\n`;
}

export function checkWsrtConfigJsonSchema(existing: string): {
	ok: boolean;
	expected: string;
} {
	const expected = serializeWsrtConfigJsonSchema();
	return { ok: existing === expected, expected };
}
