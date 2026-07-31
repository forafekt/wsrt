import os from "node:os";
import {
	createRecord,
	MigrationRegistry,
	type PersistedRecord,
	type PersistenceProvider,
	type RuntimeSession,
	type WorkspaceIdentity,
} from "@wsrt/persistence";
import { filesystemPersistence } from "@wsrt/persistence-filesystem";
import type { ControlPlaneState } from "./control-plane-state.js";
import type {
	ControlPlaneOptions,
	ControlPlaneSnapshot,
	OperationSnapshot,
	WorkspaceEvent,
} from "./types.js";
import { required } from "./utils.js";

export class PersistenceManager {
	readonly #migrations = new MigrationRegistry();
	#snapshotTimer?: ReturnType<typeof setTimeout>;

	constructor(
		private readonly state: ControlPlaneState,
		private readonly options: ControlPlaneOptions,
		private readonly snapshot: () => ControlPlaneSnapshot,
	) {}

	async initialize(): Promise<void> {
		const definition = required(this.state.definition, "Control plane definition unavailable");
		const configured = definition.persistence;
		if (
			this.options.persistence === false ||
			(this.options.persistence === undefined && configured === false)
		)
			return;

		const sessionId = crypto.randomUUID();
		const provider: PersistenceProvider =
			this.options.persistence ??
			filesystemPersistence({
				root: configured === false ? ".wsrt" : configured.root,
				journals: configured === false ? undefined : configured.journals,
			});

		try {
			await provider.initialize({ workspaceRoot: definition.root, sessionId });
			this.state.persistence = provider;
			const existing =
				await provider.read<PersistedRecord<WorkspaceIdentity>>("workspace/identity");
			const migrated = existing
				? this.#migrations.read<WorkspaceIdentity>(existing.value, "wsrt.workspace-identity")
				: undefined;
			const now = new Date().toISOString();
			const identity: WorkspaceIdentity = migrated
				? { ...migrated.data, root: definition.root }
				: { id: crypto.randomUUID(), createdAt: now, root: definition.root };
			this.state.workspaceIdentity = identity;
			await provider.write(
				"workspace/identity",
				createRecord("wsrt.workspace-identity", identity, {
					workspaceId: identity.id,
					previous: migrated,
				}),
			);

			await this.#recoverInterruptedSessions(provider, identity, now);
			this.state.session = {
				id: sessionId,
				workspaceId: identity.id,
				startedAt: now,
				wsrtVersion: "0.1.0-alpha.0",
				host: { hostname: os.hostname(), platform: process.platform, arch: process.arch },
			};
			await provider.write(
				`session/${sessionId}`,
				createRecord("wsrt.runtime-session", this.state.session, {
					workspaceId: identity.id,
					sessionId,
				}),
			);
		} catch (cause) {
			await provider.dispose().catch(() => {});
			this.state.persistence = undefined;
			throw cause;
		}
	}

	scheduleSnapshot(): void {
		if (!this.state.persistence || this.state.disposed || this.#snapshotTimer) return;
		this.#snapshotTimer = setTimeout(() => {
			this.#snapshotTimer = undefined;
			void this.persistSnapshot();
		}, 100);
		this.#snapshotTimer.unref?.();
	}

	async persistSnapshot(): Promise<void> {
		const { persistence, workspaceIdentity, session, definition } = this.state;
		if (!persistence || !workspaceIdentity || !session || !definition) return;
		try {
			await persistence.write(
				"snapshot/latest",
				createRecord("wsrt.control-plane-snapshot", JSON.parse(JSON.stringify(this.snapshot())), {
					workspaceId: workspaceIdentity.id,
					sessionId: session.id,
				}),
			);
		} catch (cause) {
			this.recordFailure(cause);
		}
	}

	async persistOperation(operation: OperationSnapshot): Promise<void> {
		const { persistence, workspaceIdentity, session } = this.state;
		if (!persistence || !workspaceIdentity || !session) return;
		try {
			await persistence.write(
				`operation/${operation.id}`,
				createRecord("wsrt.operation", JSON.parse(JSON.stringify(operation)), {
					workspaceId: workspaceIdentity.id,
					sessionId: session.id,
				}),
			);
		} catch (cause) {
			this.recordFailure(cause);
		}
	}

	persistEvent(event: WorkspaceEvent): void {
		const { persistence, workspaceIdentity, session } = this.state;
		if (!persistence || !workspaceIdentity || !session) return;
		const metadata = { workspaceId: workspaceIdentity.id, sessionId: session.id };
		void persistence
			.append(
				"journal/events",
				createRecord("wsrt.event", JSON.parse(JSON.stringify(event)), metadata),
			)
			.catch((cause) => this.recordFailure(cause));
		if (event.type.startsWith("plugin.log."))
			void persistence
				.append(
					"journal/logs",
					createRecord("wsrt.log", JSON.parse(JSON.stringify(event)), metadata),
				)
				.catch((cause) => this.recordFailure(cause));
	}

	async dispose(): Promise<void> {
		if (this.#snapshotTimer) clearTimeout(this.#snapshotTimer);
		this.#snapshotTimer = undefined;
		await this.persistSnapshot();
		const { persistence, workspaceIdentity, session } = this.state;
		if (!persistence || !session) return;
		const ended: RuntimeSession = {
			...session,
			endedAt: new Date().toISOString(),
			exitReason: "shutdown",
		};
		this.state.session = ended;
		await persistence.write(
			`session/${ended.id}`,
			createRecord("wsrt.runtime-session", ended, {
				workspaceId: workspaceIdentity?.id ?? ended.workspaceId,
				sessionId: ended.id,
			}),
		);
		await persistence.flush?.();
		await persistence.dispose();
	}

	recordFailure(cause: unknown): void {
		if (this.state.persistenceFailure) return;
		this.state.persistenceFailure = cause;
		this.state.diagnostics.push({
			code: "WSRT_PERSISTENCE_WRITE_FAILED",
			severity: "warning",
			message: cause instanceof Error ? cause.message : String(cause),
			source: { file: this.state.definition?.sourceFile ?? "<persistence>", path: "persistence" },
		});
	}

	async #recoverInterruptedSessions(
		provider: PersistenceProvider,
		identity: WorkspaceIdentity,
		now: string,
	): Promise<void> {
		for (const entry of await provider.list("session")) {
			try {
				const value = await provider.read<PersistedRecord<RuntimeSession>>(entry.key);
				if (!value) continue;
				const stored = this.#migrations.read<RuntimeSession>(value.value, "wsrt.runtime-session");
				if (stored.data.endedAt) continue;
				const interrupted = { ...stored.data, endedAt: now, exitReason: "unknown" as const };
				await provider.write(
					entry.key,
					createRecord("wsrt.runtime-session", interrupted, {
						workspaceId: identity.id,
						sessionId: interrupted.id,
						previous: stored,
					}),
				);
				this.state.diagnostics.push({
					code: "WSRT_PREVIOUS_SESSION_INTERRUPTED",
					severity: "warning",
					message: `Previous session ${interrupted.id} did not shut down cleanly`,
					source: {
						file: required(this.state.definition, "Definition unavailable").sourceFile,
						path: "persistence",
					},
				});
			} catch (cause) {
				this.state.diagnostics.push({
					code: "WSRT_PERSISTED_SESSION_INVALID",
					severity: "warning",
					message: `Unable to recover ${entry.key}: ${cause instanceof Error ? cause.message : String(cause)}`,
					source: {
						file: required(this.state.definition, "Definition unavailable").sourceFile,
						path: "persistence",
					},
				});
			}
		}
	}
}
