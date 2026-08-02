import type {
	ControlPlaneCommand,
	SubmittedOperation,
	WsrtControlPlane,
} from "@wsrt/control-plane";
import type { DashboardContribution } from "@wsrt/plugins";
import type { WorkspaceSessionClient } from "@wsrt/workspace-session";
import { safeSerializable } from "./serialization.js";
import { DASHBOARD_PROTOCOL, type DashboardSnapshot } from "./shared/contracts.js";
import { validateDashboardContributions } from "./shared/contributions.js";

export type OperationCreatingCommand = Exclude<ControlPlaneCommand, { type: "operation.cancel" }>;

export type OperationCancelCommand = Extract<ControlPlaneCommand, { type: "operation.cancel" }>;

export type DashboardCancellationResult = Readonly<{
	operationId: string;
	cancelled: boolean;
}>;

export interface DashboardBackend {
	snapshot(): DashboardSnapshot;
	subscribe(listener: (snapshot: DashboardSnapshot) => void): () => void;
	submit(command: OperationCreatingCommand): Promise<SubmittedOperation>;
	cancel(command: OperationCancelCommand): Promise<DashboardCancellationResult>;
	runContribution(contributionId: string): Promise<unknown>;
}

export async function createDirectDashboardBackend(
	controlPlane: WsrtControlPlane,
): Promise<DashboardBackend> {
	const contributions = await loadContributions(controlPlane);
	const createSnapshot = () => dashboardSnapshot(controlPlane, contributions);
	return {
		snapshot: createSnapshot,
		subscribe(listener) {
			let revision = -1;
			return controlPlane.subscribeSnapshots((snapshot) => {
				if (snapshot.revision <= revision) return;
				revision = snapshot.revision;
				listener(createSnapshot());
			});
		},
		async submit(command) {
			return controlPlane.submit(command);
		},
		cancel(command) {
			return controlPlane.execute(command);
		},
		async runContribution(contributionId) {
			const contribution = runnableContribution(controlPlane, contributionId);
			return controlPlane.invokePluginContribution("dashboard", contributionId, (context) =>
				contribution.run({}, context, new AbortController().signal),
			);
		},
	};
}

export async function createSessionDashboardBackend(
	client: WorkspaceSessionClient,
): Promise<DashboardBackend> {
	let lease = await client.acquireLease("dashboard");
	const renew = setInterval(() => {
		void client
			.renewLease(lease.id)
			.then((value) => {
				lease = value;
			})
			.catch(() => {});
	}, 10_000);
	renew.unref?.();
	let current = await sessionDashboardSnapshot(client);
	const listeners = new Set<(snapshot: DashboardSnapshot) => void>();
	let refreshing = false;
	const unsubscribe = client.subscribe((event) => {
		if (event.type !== "snapshot.updated" || refreshing) return;
		refreshing = true;
		void sessionDashboardSnapshot(client)
			.then((snapshot) => {
				if (snapshot.revision <= current.revision) return;
				current = snapshot;
				for (const listener of listeners) listener(snapshot);
			})
			.finally(() => {
				refreshing = false;
			});
	});
	return {
		snapshot: () => current,
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
				if (!listeners.size) {
					unsubscribe();
					clearInterval(renew);
					void client.releaseLease(lease.id);
				}
			};
		},
		submit: (command) => client.submit(command),
		cancel: (command) => client.execute(command) as Promise<DashboardCancellationResult>,
		runContribution: (contributionId) => client.invokeDashboardAction(contributionId),
	};
}

async function sessionDashboardSnapshot(
	client: WorkspaceSessionClient,
): Promise<DashboardSnapshot> {
	const [controlPlane, graph, events, configuration, actions] = await Promise.all([
		client.snapshot(),
		client.graph(),
		client.events(),
		client.definition(),
		client.dashboardActions(),
	]);
	return Object.freeze({
		protocolVersion: 3,
		protocol: DASHBOARD_PROTOCOL,
		revision: controlPlane.revision,
		controlPlane,
		graph: graph as DashboardSnapshot["graph"],
		events: events.map((event) => ({ ...event, payload: boundedValue(event.payload) })),
		configuration: safeSerializable(configuration),
		contributions: actions.map((action) => ({
			id: action.id,
			kind: "action" as const,
			title: action.title,
			description: action.description,
		})),
	});
}

async function loadContributions(controlPlane: WsrtControlPlane) {
	return validateDashboardContributions(
		await Promise.all(
			controlPlane.pluginContributions("dashboard").map(async (contribution) => {
				try {
					const data = contribution.load
						? await controlPlane.invokePluginContribution("dashboard", contribution.id, (context) =>
								contribution.load?.(context, new AbortController().signal),
							)
						: undefined;
					return safeSerializable({
						...contribution,
						load: undefined,
						run: undefined,
						data,
					});
				} catch (cause) {
					return {
						id: contribution.id,
						kind: contribution.kind,
						title: contribution.title,
						error: cause instanceof Error ? cause.message : String(cause),
					};
				}
			}),
		),
	);
}

function runnableContribution(
	controlPlane: WsrtControlPlane,
	contributionId: string,
): DashboardContribution & Required<Pick<DashboardContribution, "run">> {
	const contribution = controlPlane
		.pluginContributions("dashboard")
		.find(
			(item) =>
				["action", "command", "artifact-action", "operation-action"].includes(item.kind) &&
				item.id === contributionId,
		);
	if (!contribution?.run) throw new Error(`Action ${contributionId} was not found`);
	return { ...contribution, run: contribution.run };
}

function dashboardSnapshot(
	controlPlane: WsrtControlPlane,
	contributions: DashboardSnapshot["contributions"],
): DashboardSnapshot {
	const snapshot = controlPlane.snapshot();
	return Object.freeze({
		protocolVersion: 3,
		protocol: DASHBOARD_PROTOCOL,
		revision: snapshot.revision,
		controlPlane: snapshot,
		graph: controlPlane.graph().toJSON(),
		events: controlPlane.listEvents().map((event) => ({
			...event,
			payload: boundedValue(event.payload),
		})),
		configuration: safeSerializable(controlPlane.definition()),
		contributions,
	});
}

function boundedValue(value: unknown): unknown {
	try {
		const encoded = JSON.stringify(value);
		if (!encoded || encoded.length <= 65_536) return safeSerializable(value);
		return {
			truncated: true,
			originalBytes: Buffer.byteLength(encoded),
			preview: encoded.slice(0, 4096),
		};
	} catch {
		return { truncated: true, reason: "Event payload was not serializable" };
	}
}
