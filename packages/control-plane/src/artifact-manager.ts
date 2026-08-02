import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ArtifactCandidate, ProviderInvocationContext } from "@wsrt/capabilities";
import type { NormalizedExecutable, NormalizedSystemDefinition } from "@wsrt/config";
import type { PluginContext } from "@wsrt/plugins";
import type { ControlPlaneState } from "./control-plane-state.js";
import type { EventJournal } from "./event-journal.js";
import { required } from "./utils.js";

export interface ArtifactManagerOptions {
	readonly state: ControlPlaneState;
	readonly events: EventJournal;
	readonly changed: () => void;
	readonly pluginContext: () => PluginContext;
	readonly providerContext: (
		item: NormalizedExecutable,
		contributionId: string,
		signal: AbortSignal,
	) => ProviderInvocationContext;
	readonly operationId: (nodeId: string) => string;
}

/**
 * Owns the complete control-plane artifact lifecycle.
 *
 * ExecutionManager reports and collects candidates through this class, while
 * task execution uses it to invalidate and verify declared outputs.
 */
export class ArtifactManager {
	constructor(private readonly options: ArtifactManagerOptions) {}

	list() {
		return [...this.options.state.artifacts.values()];
	}

	/** Registers artifacts declared by the normalized system definition. */
	initialize(definition: NormalizedSystemDefinition): void {
		for (const artifact of definition.artifacts) {
			this.options.state.artifacts.set(artifact.id, {
				id: artifact.id,
				type: artifact.type,
				producer: artifact.producer,
				consumers: artifact.consumers,
				location: artifact.location,
				status: "pending",
				metadata: artifact.metadata,
			});
		}
	}

	/**
	 * Collects artifact candidates contributed by the executable's provider.
	 * Duplicate candidates are collapsed by name/path before ingestion.
	 */
	async collect(item: NormalizedExecutable, signal: AbortSignal): Promise<void> {
		const providerId = item.provider?.provider;
		const provider = providerId ? this.options.state.artifactProviders.get(providerId) : undefined;

		if (!provider || !providerId || signal.aborted) return;

		const pluginSession = required(this.options.state.pluginSession, "Plugin session unavailable");

		const candidates = await pluginSession.invoke(
			"artifacts",
			providerId,
			this.options.pluginContext(),
			() =>
				provider.collect(
					item.provider?.options ?? {},
					this.options.providerContext(item, providerId, signal),
				),
		);

		if (signal.aborted) return;

		const unique = new Map<string, ArtifactCandidate>();
		for (const candidate of candidates) {
			unique.set(`${candidate.name ?? ""}:${candidate.path}`, candidate);
		}

		for (const candidate of [...unique.values()].sort((a, b) => a.path.localeCompare(b.path))) {
			await this.ingest(item, candidate);
		}
	}

	/**
	 * Serializes artifact candidates reported through execution telemetry.
	 * This preserves candidate order and allows ExecutionManager to await all
	 * pending ingestion before verifying task outputs.
	 */
	ingestReported(item: NormalizedExecutable, candidate: ArtifactCandidate): void {
		const pending = (this.options.state.telemetryIngestion.get(item.id) ?? Promise.resolve())
			.then(() => this.ingest(item, candidate))
			.catch((cause) => {
				this.options.state.diagnostics.push({
					code: "WSRT_ARTIFACT_INVALID_CANDIDATE",
					severity: "warning",
					message: cause instanceof Error ? cause.message : String(cause),
					source: item.source,
				});
			});

		this.options.state.telemetryIngestion.set(item.id, pending);
	}

	async awaitReported(nodeId: string): Promise<void> {
		await this.options.state.telemetryIngestion.get(nodeId);
	}

	async ingest(item: NormalizedExecutable, candidate: ArtifactCandidate): Promise<void> {
		const workspaceRoot = this.definition().root;
		const file = path.resolve(item.root, candidate.path);
		this.assertInsideWorkspace(file, workspaceRoot);

		const name = candidate.name ?? path.basename(candidate.path);
		const id = `artifact:${name}`;
		const existing = this.options.state.artifacts.get(id);

		this.options.state.artifacts.set(id, {
			...existing,
			id,
			type: candidate.kind ?? existing?.type ?? "file",
			producer: item.name,
			consumers: existing?.consumers ?? [],
			location: file,
			status: "generating",
			metadata: Object.freeze({
				...(existing?.metadata ?? {}),
				...(candidate.metadata ?? {}),
				mediaType: candidate.mediaType,
				outputGroup: candidate.outputGroup,
			}),
		});

		this.options.events.emit("artifact.discovered", id, this.options.operationId(item.id), {
			path: file,
		});
	}

	async invalidateOutputs(item: NormalizedExecutable): Promise<void> {
		for (const artifact of this.options.state.artifacts.values()) {
			if (
				artifact.producer !== item.name &&
				!item.outputs.some((output) => `artifact:${output.artifact}` === artifact.id)
			) {
				continue;
			}

			const now = new Date().toISOString();
			this.options.state.artifacts.set(artifact.id, {
				...artifact,
				status: "invalid",
				invalidatedAt: now,
			});

			this.options.events.emit("artifact.invalidated", artifact.id, item.id, {});
		}
	}

	async failOutputs(item: NormalizedExecutable, message: string): Promise<void> {
		let changed = false;

		for (const artifact of this.options.state.artifacts.values()) {
			if (artifact.producer !== item.name) continue;

			changed = true;
			this.options.state.artifacts.set(artifact.id, {
				...artifact,
				status: "failed",
				diagnostics: [
					{
						code: "WSRT_ARTIFACT_GENERATION_FAILED",
						severity: "error",
						message,
						source: item.source,
					},
				],
			});
		}

		if (changed) this.options.changed();
	}

	async verifyOutputs(item: NormalizedExecutable): Promise<void> {
		const outputs = item.outputs.length
			? item.outputs
			: [...this.options.state.artifacts.values()]
					.filter((artifact) => artifact.producer === item.name && artifact.location)
					.map((artifact) => ({
						artifact: artifact.id.replace(/^artifact:/, ""),
						path: artifact.location ?? "",
					}));

		for (const output of outputs) {
			const id = `artifact:${output.artifact}`;
			const artifact = this.options.state.artifacts.get(id);

			if (!artifact) {
				throw new Error(`WSRT_ARTIFACT_OUTPUT_MISSING: ${id}`);
			}

			const file = path.resolve(item.root, output.path);
			this.assertInsideWorkspace(file, this.definition().root);

			let bytes: Uint8Array;
			try {
				bytes = await fs.readFile(file);
			} catch {
				await this.failOutputs(item, `Declared output does not exist: ${file}`);
				throw new Error(`WSRT_ARTIFACT_OUTPUT_MISSING: ${file}`);
			}

			const hash = createHash("sha256").update(bytes).digest("hex");
			const now = new Date().toISOString();
			const unchanged = artifact.hash === hash;

			this.options.state.artifacts.set(id, {
				...artifact,
				location: file,
				status: unchanged ? "unchanged" : "ready",
				hash,
				size: bytes.byteLength,
				createdAt: artifact.createdAt ?? now,
				updatedAt: now,
				diagnostics: [],
			});

			this.options.events.emit(
				unchanged ? "artifact.unchanged" : "artifact.generated",
				id,
				item.id,
				{
					hash,
					size: bytes.byteLength,
				},
			);
		}
	}

	private definition(): NormalizedSystemDefinition {
		return required(this.options.state.definition, "Control plane is not loaded");
	}

	private assertInsideWorkspace(file: string, workspaceRoot: string): void {
		const relative = path.relative(workspaceRoot, file);
		if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
			throw new Error(`WSRT_ARTIFACT_PATH_INVALID: ${file}`);
		}
	}
}
