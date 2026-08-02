import type { SourceAssociationRole } from "@wsrt/config";
import type { ControlPlaneCommand } from "@wsrt/control-plane";
import type { SystemEdgeKind, SystemNodeKind } from "@wsrt/graph";

export { sourceAssociationRoles as workspaceFileRoles } from "@wsrt/config";

export type { WorkspaceIntelligenceSources } from "./workspace-intelligence.js";

export { DefaultWorkspaceIntelligence } from "./workspace-intelligence.js";

export const WORKSPACE_INTELLIGENCE_SCHEMA_VERSION = "1" as const;

export const evidenceTypes = Object.freeze([
	"configuration",
	"plugin",
	"manifest",
	"runtime",
	"workspace",
	"derived",
] as const);

export type EvidenceType = (typeof evidenceTypes)[number];

export type EvidenceRecord = Readonly<{
	type: EvidenceType;
	source: string;
	file?: string;
	line?: number;
	reason: string;
}>;

export type WorkspaceDescription = Readonly<{
	id: string;
	name: string;
	root: string;
	packageManager?: string;
	evidence: readonly EvidenceRecord[];
}>;

export type ProjectDescription = Readonly<{
	id: string;
	name: string;
	root: string;
	kind: "package" | "project";
	private?: boolean;
	publishable?: boolean;
	evidence: readonly EvidenceRecord[];
}>;

export type WorkspaceFileRole = SourceAssociationRole;

export type WorkspaceFileAssociation = Readonly<{
	path: string;
	role: WorkspaceFileRole;
	generated: boolean;
	evidence: readonly EvidenceRecord[];
}>;

export type WorkspaceRuntimeReference = Readonly<{
	provider?: string;
	runtime?: string;
	processId?: number;
	state?: string;
}>;

export type WorkspaceHealthReference = Readonly<{
	state: "unknown" | "checking" | "healthy" | "degraded" | "unhealthy";
	diagnostic?: string;
}>;

export type WorkspaceOperationDescription = Readonly<{
	type: string;
	permission?: string;
	available: boolean;
}>;

export type WorkspaceNodeDescription = Readonly<{
	id: string;
	kind: SystemNodeKind;
	name: string;
	projectId?: string;
	lifecycleState?: string;
	health?: WorkspaceHealthReference;
	runtime?: WorkspaceRuntimeReference;
	files: readonly WorkspaceFileAssociation[];
	artifacts: readonly string[];
	operations: readonly WorkspaceOperationDescription[];
	metadata: Readonly<Record<string, unknown>>;
	evidence: readonly EvidenceRecord[];
}>;

export type WorkspaceRelationship = Readonly<{
	from: string;
	to: string;
	kind: SystemEdgeKind;
	condition?: string;
	metadata: Readonly<Record<string, unknown>>;
	evidence: readonly EvidenceRecord[];
}>;

export type WorkspaceCapability = Readonly<{
	id: string;
	available: boolean;
	version?: string;
	details?: Readonly<Record<string, unknown>>;
}>;

export type WorkspaceIntelligenceSnapshot = Readonly<{
	schemaVersion: typeof WORKSPACE_INTELLIGENCE_SCHEMA_VERSION;
	workspaceRevision: number;
	generatedAt: string;
	workspace: WorkspaceDescription;
	projects: readonly ProjectDescription[];
	nodes: readonly WorkspaceNodeDescription[];
	relationships: readonly WorkspaceRelationship[];
	capabilities: readonly WorkspaceCapability[];
}>;

export type GraphQueryDirection = "dependencies" | "dependents" | "both";

export type GraphQuery = Readonly<{
	roots: readonly string[];
	direction?: GraphQueryDirection;
	depth?: number;
	kinds?: readonly SystemNodeKind[];
	limit?: number;
}>;

export type GraphQueryResult = Readonly<{
	workspaceRevision: number;
	nodes: readonly WorkspaceNodeDescription[];
	relationships: readonly WorkspaceRelationship[];
	truncated: boolean;
}>;

export type FileQuery = Readonly<{
	nodeIds?: readonly string[];
	projectIds?: readonly string[];
	roles?: readonly WorkspaceFileRole[];
	paths?: readonly string[];
	includeGenerated?: boolean;
	limit?: number;
	cursor?: string;
}>;

export type WorkspaceFileDescription = WorkspaceFileAssociation &
	Readonly<{
		owners: readonly string[];
		projectIds: readonly string[];
	}>;

export type FileQueryResult = Readonly<{
	workspaceRevision: number;
	files: readonly WorkspaceFileDescription[];
	nextCursor?: string;
}>;

export type NodeQuery = Readonly<{
	kinds?: readonly SystemNodeKind[];
	lifecycleStates?: readonly string[];
	healthStates?: readonly WorkspaceHealthReference["state"][];
	projectIds?: readonly string[];
	limit?: number;
	cursor?: string;
}>;

export type NodeQueryResult = Readonly<{
	workspaceRevision: number;
	nodes: readonly WorkspaceNodeDescription[];
	nextCursor?: string;
}>;

export type ChangeImpactConfidence = "declared" | "derived" | "inferred" | "unknown";

export type ChangeImpactQuery = Readonly<{
	paths: readonly string[];
}>;

export type ChangeImpactResult = Readonly<{
	workspaceRevision: number;
	affectedProjects: readonly ProjectDescription[];
	affectedNodes: readonly WorkspaceNodeDescription[];
	affectedTasks: readonly WorkspaceNodeDescription[];
	recommendedValidations: readonly string[];
	evidence: readonly EvidenceRecord[];
	confidence: ChangeImpactConfidence;
}>;

export type CommandPlan = Readonly<{
	command: ControlPlaneCommand;
	valid: boolean;
	resolvedTargets: readonly string[];
	dependencyActions: readonly Readonly<{ action: string; target: string }>[];
	affectedProcesses: readonly string[];
	resources: readonly string[];
	requiredPermissions: readonly string[];
	risk: "low" | "medium" | "high";
	warnings: readonly string[];
	evidence: readonly EvidenceRecord[];
}>;

export interface WorkspaceIntelligence {
	describeWorkspace(): WorkspaceIntelligenceSnapshot;
	describeNode(id: string): WorkspaceNodeDescription;
	queryGraph(query: GraphQuery): GraphQueryResult;
	queryFiles(query: FileQuery): FileQueryResult;
	queryNodes(query: NodeQuery): NodeQueryResult;
	analyzeChangeImpact(query: ChangeImpactQuery): ChangeImpactResult;
	planCommand(command: ControlPlaneCommand): CommandPlan;
}
