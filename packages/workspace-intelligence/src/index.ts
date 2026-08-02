import type { SourceAssociationRole } from "@wsrt/config";
import type { ControlPlaneCommand } from "@wsrt/control-plane";
import type { SystemEdgeKind, SystemNodeKind } from "@wsrt/graph";

export { sourceAssociationRoles as workspaceFileRoles } from "@wsrt/config";

export type { WorkspaceIntelligenceSources } from "./workspace-intelligence.js";

export { DefaultWorkspaceIntelligence } from "./workspace-intelligence.js";

export const WORKSPACE_INTELLIGENCE_SCHEMA_VERSION = "2" as const;

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

export type EvidenceCollection = Readonly<{
	records: Readonly<Record<string, EvidenceRecord>>;
}>;

export type EvidenceConfidence = "declared" | "derived" | "inferred" | "unknown";

export type WorkspaceKnowledgeSupport = "full" | "partial" | "unavailable";

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
	ownerId: string;
	ownerKind: SystemNodeKind;
	projectId?: string;
	path: string;
	match: "exact" | "glob";
	role: WorkspaceFileRole;
	generated: boolean;
	contributionSources: readonly string[];
	producerId?: string;
	consumerIds?: readonly string[];
	evidence: readonly EvidenceRecord[];
	confidence: EvidenceConfidence;
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

export type WorkspaceProviderMetadata = Readonly<{
	provider?: string;
	runtimeId?: string;
	command?: string;
	arguments?: readonly string[];
	workingDirectory?: string;
	ports?: readonly number[];
	urls?: readonly string[];
	readiness?: Readonly<Record<string, unknown>>;
	healthCheck?: Readonly<Record<string, unknown>>;
	entrypoints?: readonly string[];
	configurationFiles?: readonly string[];
	outputPatterns?: readonly string[];
	artifactIds?: readonly string[];
	environmentVariableNames?: readonly string[];
	evidence: readonly EvidenceRecord[];
}>;

export type WorkspaceNodeDescription = Readonly<{
	id: string;
	canonicalId: string;
	aliases: readonly string[];
	parentId?: string;
	matchedAlias?: string;
	kind: SystemNodeKind;
	name: string;
	projectId?: string;
	lifecycleState?: string;
	health?: WorkspaceHealthReference;
	runtime?: WorkspaceRuntimeReference;
	files: readonly WorkspaceFileAssociation[];
	artifacts: readonly string[];
	prerequisiteTaskIds: readonly string[];
	operations: readonly WorkspaceOperationDescription[];
	metadata: Readonly<Record<string, unknown>>;
	providerMetadata?: WorkspaceProviderMetadata;
	evidence: readonly EvidenceRecord[];
	aggregation?: Readonly<{
		depth: number;
		includedNodeIds: readonly string[];
		originalOwnerIds: readonly string[];
	}>;
	includedNodes?: readonly WorkspaceNodeDescription[];
	includedRelationships?: readonly WorkspaceRelationship[];
}>;

export type NodeDescriptionSection = "children" | "relationships";

export type DescribeNodeOptions = Readonly<{
	include?: readonly NodeDescriptionSection[];
	aggregate?: boolean;
	depth?: number;
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

export type SuggestedWorkspaceCall = Readonly<{
	operation: string;
	arguments: Readonly<Record<string, unknown>>;
	reason: string;
}>;

export type WorkspaceGetStarted = Readonly<{
	workspace: Readonly<{ id: string; name: string }>;
	protocolVersion?: number;
	capabilities: readonly WorkspaceCapability[];
	importantNodeIds: readonly string[];
	canonicalIdRules: readonly string[];
	recommendedCalls: readonly SuggestedWorkspaceCall[];
	limitations: readonly string[];
	querySemantics: Readonly<{
		nodeDescriptions: string;
		impactResponses: string;
	}>;
	authorityBoundaries: readonly string[];
	availableAdapters: readonly string[];
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
	taskIds?: readonly string[];
	artifactIds?: readonly string[];
	roles?: readonly WorkspaceFileRole[];
	paths?: readonly string[];
	patterns?: readonly string[];
	includeGenerated?: boolean;
	includePatterns?: boolean;
	includeMatchedFiles?: boolean;
	aggregate?: boolean;
	limit?: number;
	cursor?: string;
}>;

export type WorkspaceFileDescription = WorkspaceFileAssociation &
	Readonly<{
		requestedOwnerIds: readonly string[];
		relationship: "direct" | "composed-child";
		owners: readonly string[];
		projectIds: readonly string[];
	}>;

export type FileQueryResult = Readonly<{
	workspaceRevision: number;
	support: WorkspaceKnowledgeSupport;
	files: readonly WorkspaceFileDescription[];
	unresolvedPatterns: readonly Readonly<{ pattern: string; reason: string }>[];
	warnings: readonly Readonly<{ code: string; message: string }>[];
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

export type ChangeImpactConfidence = EvidenceConfidence;

export const impactRelationships = Object.freeze([
	"direct-owner",
	"composite-parent",
	"dependent-runtime",
	"validation-task",
	"produced-artifact",
	"potentially-affected",
	"related",
] as const);

export type ImpactRelationship = (typeof impactRelationships)[number];

export type WorkspaceImpactEntity = Readonly<{
	id: string;
	kind: SystemNodeKind;
	name: string;
	relationship: ImpactRelationship;
	direct: boolean;
	path: readonly string[];
	reason: string;
	confidence: EvidenceConfidence;
	evidenceIds: readonly string[];
}>;

export type ChangeImpactQuery = Readonly<{
	paths: readonly string[];
	expand?: readonly ("nodes" | "projects" | "tasks" | "artifacts" | "files" | "evidence")[];
}>;

export type ChangeImpactResult = Readonly<{
	workspaceRevision: number;
	support: WorkspaceKnowledgeSupport;
	entities: readonly WorkspaceImpactEntity[];
	affectedFiles?: readonly WorkspaceFileDescription[];
	directOwnerIds: readonly string[];
	aggregateOwnerIds: readonly string[];
	affectedProjects?: readonly ProjectDescription[];
	affectedNodes?: readonly WorkspaceNodeDescription[];
	affectedApplications?: readonly WorkspaceNodeDescription[];
	affectedProcesses?: readonly WorkspaceNodeDescription[];
	affectedTasks?: readonly WorkspaceNodeDescription[];
	affectedArtifacts?: readonly WorkspaceNodeDescription[];
	recommendedValidations: readonly string[];
	evidence?: EvidenceCollection;
	confidence: ChangeImpactConfidence;
	warnings: readonly Readonly<{ code: string; message: string }>[];
}>;

export type ValidationRecommendation = Readonly<{
	taskId: string;
	reason: string;
	confidence: EvidenceConfidence;
	evidenceIds: readonly string[];
	prerequisiteTaskIds: readonly string[];
	coveredTaskIds?: readonly string[];
}>;

export type ValidationRecommendationResult = Readonly<{
	workspaceRevision: number;
	support: WorkspaceKnowledgeSupport;
	recommendations: readonly ValidationRecommendation[];
	evidence: EvidenceCollection;
	warnings: readonly Readonly<{ code: string; message: string }>[];
}>;

export type CommandPlan = Readonly<{
	command: ControlPlaneCommand;
	valid: boolean;
	requestedTargets: readonly string[];
	expandedTargets: readonly string[];
	actions: readonly Readonly<{
		id: string;
		action: "start" | "stop" | "restart" | "run" | "cancel";
		target: string;
		prerequisite: boolean;
	}>[];
	prerequisiteActions: readonly string[];
	executionOrder: readonly string[];
	readinessRequirements: readonly Readonly<{ from: string; to: string; condition?: string }>[];
	affectedNodes: readonly string[];
	affectedProcesses: readonly string[];
	resources: readonly string[];
	expectedArtifacts: readonly string[];
	requiredPermissions: readonly string[];
	risk: "low" | "medium" | "high";
	warnings: readonly string[];
	evidence: readonly EvidenceRecord[];
}>;

export interface WorkspaceIntelligence {
	describeWorkspace(): WorkspaceIntelligenceSnapshot;
	getStarted(): WorkspaceGetStarted;
	describeNode(id: string, options?: DescribeNodeOptions): WorkspaceNodeDescription;
	queryGraph(query: GraphQuery): GraphQueryResult;
	queryFiles(query: FileQuery): FileQueryResult;
	queryNodes(query: NodeQuery): NodeQueryResult;
	analyzeChangeImpact(query: ChangeImpactQuery): ChangeImpactResult;
	recommendValidation(query: ChangeImpactQuery): ValidationRecommendationResult;
	planCommand(command: ControlPlaneCommand): CommandPlan;
}
