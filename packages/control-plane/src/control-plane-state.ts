import type {
	ArtifactProvider,
	ExecutionAdapter,
	ProcessHandle,
	ReadinessProvider,
	RuntimeInstance,
} from "@wsrt/capabilities";
import type { NormalizedSystemDefinition, SystemDiagnostic } from "@wsrt/config";
import type { SystemGraph } from "@wsrt/graph";
import type { LifecycleEngine } from "@wsrt/lifecycle";
import type { PersistenceProvider, RuntimeSession, WorkspaceIdentity } from "@wsrt/persistence";
import type { PluginSession } from "@wsrt/plugins";
import type {
	ArtifactRecord,
	HealthState,
	NodeSnapshot,
	OperationSnapshot,
	WorkspaceEvent,
} from "./types.js";

export type NodeHealthDetails = Omit<
	NodeSnapshot,
	"id" | "kind" | "state" | "health" | "runtime" | "pid"
>;

export class ControlPlaneState {
	readonly events: WorkspaceEvent[] = [];
	readonly artifacts = new Map<string, ArtifactRecord>();
	readonly handles = new Map<string, ProcessHandle>();
	readonly runtimes = new Map<string, RuntimeInstance>();
	readonly operations: OperationSnapshot[] = [];
	readonly health = new Map<string, HealthState>();
	readonly healthDetails = new Map<string, NodeHealthDetails>();
	readonly adapters = new Map<string, ExecutionAdapter>();
	readonly readinessProviders = new Map<string, ReadinessProvider>();
	readonly artifactProviders = new Map<string, ArtifactProvider>();
	readonly executionMetadata = new Map<string, Record<string, unknown>>();
	readonly executionSignals = new Map<string, AbortSignal>();
	readonly executionCleanup = new Map<string, () => void | Promise<void>>();
	readonly telemetryIngestion = new Map<string, Promise<void>>();
	readonly closedExecutions = new Set<string>();
	readonly completedExecutions = new Set<string>();
	readonly manualStops = new Set<string>();
	readonly nodeOperations = new Map<string, string>();
	readonly operationControllers = new Map<string, AbortController>();

	disposed = false;
	revision = 0;
	definition?: NormalizedSystemDefinition;
	graph?: SystemGraph;
	engine?: LifecycleEngine;
	diagnostics: SystemDiagnostic[] = [];
	providerIds: string[] = [];
	pluginSession?: PluginSession;
	persistence?: PersistenceProvider;
	workspaceIdentity?: WorkspaceIdentity;
	session?: RuntimeSession;
	persistenceFailure?: unknown;
}
