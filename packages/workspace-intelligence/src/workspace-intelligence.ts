import path from "node:path";
import type { NormalizedSystemDefinition } from "@wsrt/config";
import {
	type ControlPlaneCommand,
	type ControlPlaneSnapshot,
	canonicalProcessId,
	controlPlaneCommandPermission,
	selectStartClosure,
} from "@wsrt/control-plane";
import type { SystemGraph, SystemNode } from "@wsrt/graph";
import type { WorkspaceIntelligenceContribution } from "@wsrt/plugins";
import type { ResolvedWorkspace } from "@wsrt/workspace";
import {
	matchesWorkspacePattern,
	normalizeWorkspaceRelativePath,
	workspacePatternKind,
} from "@wsrt/workspace";
import {
	type ChangeImpactQuery,
	type ChangeImpactResult,
	type CommandPlan,
	type DescribeNodeOptions,
	type EvidenceCollection,
	type EvidenceRecord,
	type FileQuery,
	type FileQueryResult,
	type GraphQuery,
	type GraphQueryResult,
	type NodeQuery,
	type NodeQueryResult,
	type ProjectDescription,
	type ValidationRecommendationResult,
	WORKSPACE_INTELLIGENCE_SCHEMA_VERSION,
	type WorkspaceFileAssociation,
	type WorkspaceGetStarted,
	type WorkspaceImpactEntity,
	type WorkspaceIntelligence,
	type WorkspaceIntelligenceSnapshot,
	type WorkspaceNodeDescription,
	type WorkspaceRelationship,
} from "./index.js";

export type WorkspaceIntelligenceSources = Readonly<{
	workspaceId: string;
	definition: NormalizedSystemDefinition;
	graph: SystemGraph;
	snapshot: () => ControlPlaneSnapshot;
	workspace?: ResolvedWorkspace;
	contributions?: readonly WorkspaceIntelligenceContribution[];
	hostFeatures?: Readonly<{
		protocolVersion?: number;
		transports?: readonly string[];
		logs?: boolean;
		changeImpact?: boolean;
		commandPlanning?: boolean;
		commandExecution?: boolean;
		subscriptions?: boolean;
		permissions?: readonly string[];
	}>;
}>;

export class DefaultWorkspaceIntelligence implements WorkspaceIntelligence {
	#cached?: WorkspaceIntelligenceSnapshot;
	#associationIndex?: AssociationIndex;
	constructor(readonly sources: WorkspaceIntelligenceSources) {}

	describeWorkspace(): WorkspaceIntelligenceSnapshot {
		const live = this.sources.snapshot();
		if (this.#cached?.workspaceRevision === live.revision) return this.#cached;
		const configuration = configurationEvidence(this.sources.definition);
		const projects = this.#projects();
		this.#cached = freeze({
			schemaVersion: WORKSPACE_INTELLIGENCE_SCHEMA_VERSION,
			workspaceRevision: live.revision,
			generatedAt: live.generatedAt,
			workspace: {
				id: this.sources.workspaceId,
				name: this.sources.definition.name,
				root: this.sources.definition.root,
				...(this.sources.definition.workspace.packageManager
					? { packageManager: this.sources.definition.workspace.packageManager }
					: {}),
				evidence: [configuration],
			},
			projects,
			nodes: this.sources.graph
				.nodes()
				.map((node) => this.#node(node, live, projects))
				.sort(byId),
			relationships: this.#relationships(configuration),
			capabilities: this.#capabilities(),
		});
		return this.#cached;
	}

	getStarted(): WorkspaceGetStarted {
		const snapshot = this.describeWorkspace();
		const protocolVersion = this.sources.hostFeatures?.protocolVersion;
		const mainNode =
			snapshot.nodes.find(({ kind }) => kind === "application") ??
			snapshot.nodes.find(({ kind }) => kind === "service") ??
			snapshot.nodes.find(({ kind }) => kind !== "workspace") ??
			snapshot.nodes[0];
		const mainNodeId = mainNode?.id ?? "<canonical-node-id>";
		const scopedIds = new Set([
			mainNodeId,
			...snapshot.relationships
				.filter(({ from, kind }) => from === mainNodeId && kind === "contains")
				.map(({ to }) => to),
		]);
		const investigationPath =
			snapshot.nodes
				.filter(({ id }) => scopedIds.has(id))
				.flatMap(({ files }) => files)
				.find(({ role, generated }) => role === "configuration" && !generated)?.path ??
			snapshot.nodes
				.filter(({ id }) => scopedIds.has(id))
				.flatMap(({ files }) => files)
				.find(({ generated }) => !generated)?.path ??
			"<changed-workspace-path>";
		return freeze({
			workspace: { id: snapshot.workspace.id, name: snapshot.workspace.name },
			...(protocolVersion !== undefined ? { protocolVersion } : {}),
			capabilities: snapshot.capabilities,
			importantNodeIds: snapshot.nodes
				.filter(({ kind }) => ["application", "service", "task"].includes(kind))
				.map(({ id }) => id)
				.slice(0, 20),
			canonicalIdRules: [
				"Use IDs returned by workspace.nodes.query; all relationships return canonical IDs.",
				"Composite processes use application:<app>/process:<process>.",
				"Shorthand-like IDs are not accepted; unknown IDs return canonical suggestions.",
			],
			recommendedCalls: [
				{
					operation: "workspace.capabilities",
					arguments: {},
					reason: "Discover supported operations and authority boundaries.",
				},
				{
					operation: "workspace.describe",
					arguments: {},
					reason: "Understand the workspace architecture and composition.",
				},
				{
					operation: "workspace.nodes.query",
					arguments: { limit: 100 },
					reason: "Discover canonical IDs, kinds, aliases, and composition parents.",
				},
				{
					operation: "workspace.node.describe",
					arguments: { nodeId: mainNodeId, options: { aggregate: true, depth: 1 } },
					reason:
						"Inspect the main logical node and its composed executable children in one bounded response.",
				},
				{
					operation: "workspace.files.query",
					arguments: { nodeIds: [mainNodeId], aggregate: true },
					reason: "Find declared source and configuration ownership before searching broadly.",
				},
				{
					operation: "workspace.graph.query",
					arguments: { roots: [mainNodeId], direction: "both", depth: 2 },
					reason: "Bound the declared dependencies and dependants.",
				},
				{
					operation: "workspace.command.plan",
					arguments: { command: { type: "node.start", nodeIds: [mainNodeId] } },
					reason:
						"Separate the requested logical target from executable actions without changing state.",
				},
				{
					operation: "workspace.change.impact",
					arguments: { query: { paths: [investigationPath] } },
					reason: "Classify direct, transitive, validation, artifact, and related impact.",
				},
				{
					operation: "workspace.validation.recommend",
					arguments: { query: { paths: [investigationPath] } },
					reason: "Obtain ordered validations with task-specific evidence.",
				},
				{
					operation: "diagnostics.get",
					arguments: {},
					reason: "Check current configuration and runtime diagnostics.",
				},
			],
			limitations: [
				"WSRT reports configured and contributed workspace facts; it does not infer source-code semantics.",
				"Generated files are excluded from file queries unless explicitly requested.",
			],
			querySemantics: {
				nodeDescriptions:
					"Direct by default; aggregate=true adds bounded composed-child descriptions while preserving original owners.",
				impactResponses:
					"Compact classified entities by default; request expand sections for descriptions, files, or evidence.",
			},
			authorityBoundaries: [
				"The workspace session is authoritative for the loaded configuration, graph, runtime snapshot, and contributed facts.",
				"Read associated files for implementation details not declared to WSRT.",
			],
			availableAdapters: [
				"programmatic",
				"cli",
				"mcp",
				...(this.sources.hostFeatures?.transports ?? []),
			]
				.filter((value, index, values) => values.indexOf(value) === index)
				.sort(),
		});
	}

	describeNode(id: string, options: DescribeNodeOptions = {}): WorkspaceNodeDescription {
		const resolution = this.#resolveNodeId(id);
		const node = this.sources.graph.node(resolution.canonicalId);
		if (!node) throw new Error("Resolved node disappeared");
		const projects = this.#projects();
		const direct = {
			...this.#node(node, this.sources.snapshot(), projects),
			...(resolution.matchedAlias ? { matchedAlias: resolution.matchedAlias } : {}),
		};
		if (!options.aggregate) return freeze(direct);
		const depth = integer(options.depth ?? 1, "depth", 1, 32);
		const snapshot = this.describeWorkspace();
		const includedIds = new Set<string>();
		let frontier = [node.id];
		for (let level = 0; level < depth && frontier.length; level += 1) {
			const next = snapshot.relationships
				.filter(({ from, kind }) => kind === "contains" && frontier.includes(from))
				.map(({ to }) => to)
				.filter((childId) => !includedIds.has(childId))
				.sort();
			for (const childId of next) includedIds.add(childId);
			frontier = next;
		}
		const includedNodes = snapshot.nodes.filter(({ id: nodeId }) => includedIds.has(nodeId));
		const includedRelationships = snapshot.relationships.filter(
			({ from, to }) => (from === node.id || includedIds.has(from)) && includedIds.has(to),
		);
		return freeze({
			...direct,
			aggregation: {
				depth,
				includedNodeIds: includedNodes.map(({ id: nodeId }) => nodeId),
				originalOwnerIds: [
					...new Set(includedNodes.flatMap(({ files }) => files.map(({ ownerId }) => ownerId))),
				].sort(),
			},
			...(options.include?.includes("children") === false ? {} : { includedNodes }),
			...(options.include?.includes("relationships") === false ? {} : { includedRelationships }),
		});
	}

	queryGraph(query: GraphQuery): GraphQueryResult {
		const snapshot = this.describeWorkspace();
		if (!query.roots.length)
			throw intelligenceError("query.roots_required", "At least one graph root is required");
		const depth = integer(query.depth ?? 1, "depth", 0, 32);
		const limit = integer(query.limit ?? 100, "limit", 1, 500);
		const roots = query.roots.map((root) => this.#resolveNodeId(root).canonicalId);
		const ids = new Set<string>();
		let frontier = [...new Set(roots)].sort();
		let truncated = false;
		traversal: for (let level = 0; level <= depth && frontier.length; level += 1) {
			const next = new Set<string>();
			for (const id of frontier) {
				if (ids.has(id)) continue;
				if (ids.size >= limit) {
					truncated = true;
					break traversal;
				}
				ids.add(id);
				if (level === depth) continue;
				for (const node of this.#neighbors(id, query.direction ?? "dependencies"))
					if (!ids.has(node.id)) next.add(node.id);
			}
			frontier = [...next].sort();
		}
		const eligible = snapshot.nodes.filter(
			(node) => ids.has(node.id) && (!query.kinds?.length || query.kinds.includes(node.kind)),
		);
		return freeze({
			workspaceRevision: snapshot.workspaceRevision,
			nodes: eligible,
			relationships: snapshot.relationships.filter(
				(edge) =>
					eligible.some(({ id }) => id === edge.from) && eligible.some(({ id }) => id === edge.to),
			),
			truncated,
		});
	}

	queryFiles(query: FileQuery): FileQueryResult {
		const snapshot = this.describeWorkspace();
		const index = this.#fileIndex(snapshot);
		const requestedIds = new Set([
			...(query.nodeIds ?? []).map(canonicalProcessId),
			...(query.taskIds ?? []).map((id) => (id.startsWith("task:") ? id : `task:${id}`)),
			...(query.artifactIds ?? []).map((id) =>
				id.startsWith("artifact:") ? id : `artifact:${id}`,
			),
		]);
		const selectedIds = new Map<string, "direct" | "composed-child">();
		for (const id of requestedIds) selectedIds.set(id, "direct");
		if (query.aggregate !== false)
			for (const id of requestedIds)
				for (const child of this.#containedDescendants(id))
					if (!selectedIds.has(child)) selectedIds.set(child, "composed-child");
		const owners = snapshot.nodes.filter(
			(node) =>
				(!requestedIds.size || selectedIds.has(node.id)) &&
				(!query.projectIds?.length ||
					(node.projectId && query.projectIds.includes(node.projectId))),
		);
		const files = new Map<
			string,
			{ association: WorkspaceFileAssociation; owners: string[]; projects: string[] }
		>();
		const eligibleOwners = new Set(owners.map(({ id }) => id));
		const candidates = query.paths?.length
			? query.paths.flatMap((candidate) => {
					const normalized = canonicalQueryPath(candidate);
					return [
						...(index.exact.get(normalized) ?? []),
						...index.patterns.filter(({ path: pattern }) =>
							matchesWorkspacePattern(normalized, pattern),
						),
					];
				})
			: owners.flatMap(({ id }) => index.byOwner.get(id) ?? []);
		for (const association of uniqueAssociations(candidates)) {
			const owner = snapshot.nodes.find(({ id }) => id === association.ownerId);
			if (!owner || !eligibleOwners.has(owner.id)) continue;
			if (query.roles?.length && !query.roles.includes(association.role)) continue;
			if (query.patterns?.length) {
				const normalizedPatterns = query.patterns.map((pattern) =>
					normalizeWorkspaceRelativePath(pattern, { allowGlob: true }),
				);
				if (!normalizedPatterns.includes(association.path)) continue;
			}
			if (!query.includeGenerated && association.generated) continue;
			const normalizedPaths = query.paths?.map(canonicalQueryPath);
			const matchedPaths = normalizedPaths?.length
				? normalizedPaths.filter((candidate) =>
						association.match === "exact"
							? candidate === association.path
							: matchesWorkspacePattern(candidate, association.path),
					)
				: query.includePatterns === false && association.match === "glob"
					? []
					: [association.path];
			for (const matchedPath of matchedPaths) {
				const resolved =
					matchedPath === association.path
						? association
						: { ...association, path: matchedPath, match: "exact" as const };
				const key = `${resolved.ownerId}\0${resolved.path}\0${resolved.role}`;
				const item = files.get(key) ?? { association: resolved, owners: [], projects: [] };
				item.owners.push(owner.id);
				if (owner.projectId) item.projects.push(owner.projectId);
				files.set(key, item);
			}
		}
		const page = paginate(
			[...files.values()]
				.map(({ association, owners: nodeOwners, projects }) => ({
					...association,
					requestedOwnerIds: requestedIds.size ? [...requestedIds].sort() : [association.ownerId],
					relationship: selectedIds.get(association.ownerId) ?? "direct",
					owners: [...new Set(nodeOwners)].sort(),
					projectIds: [...new Set(projects)].sort(),
				}))
				.sort((a, b) => a.path.localeCompare(b.path) || a.role.localeCompare(b.role)),
			query.limit,
			query.cursor,
		);
		const warnings: { code: string; message: string }[] = [];
		const missingOwners = [...requestedIds].filter(
			(id) => !snapshot.nodes.some((node) => node.id === id),
		);
		if (missingOwners.length)
			warnings.push({
				code: "workspace.owner_not_found",
				message: `Requested owners were not found: ${missingOwners.join(", ")}`,
			});
		if (!page.items.length) {
			if (index.support === "unavailable")
				warnings.push({
					code: "workspace.ownership_unavailable",
					message: "Ownership support is unavailable for this workspace",
				});
			else if (index.support === "partial")
				warnings.push({
					code: "workspace.ownership_incomplete",
					message: "No association matched and ownership knowledge is partial",
				});
			else if (query.roles?.length)
				warnings.push({
					code: "workspace.role_unmatched",
					message: `No associations matched roles: ${query.roles.join(", ")}`,
				});
			else if (query.paths?.length)
				warnings.push({
					code: "workspace.path_unowned",
					message: "No ownership association matched the supplied path",
				});
			else
				warnings.push({
					code: "workspace.associations_empty",
					message: "The requested owner has no declared associations",
				});
		}
		if (query.includeMatchedFiles && index.patterns.length)
			warnings.push({
				code: "workspace.expansion_unavailable",
				message: "Declared patterns are returned without filesystem expansion",
			});
		return freeze({
			workspaceRevision: snapshot.workspaceRevision,
			support: this.#ownershipSupport(),
			files: page.items,
			unresolvedPatterns: [],
			warnings,
			...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
		});
	}

	#fileIndex(snapshot: WorkspaceIntelligenceSnapshot): AssociationIndex {
		if (this.#associationIndex?.revision === snapshot.workspaceRevision)
			return this.#associationIndex;
		const byOwner = new Map<string, readonly WorkspaceFileAssociation[]>();
		const byProject = new Map<string, WorkspaceFileAssociation[]>();
		const exact = new Map<string, WorkspaceFileAssociation[]>();
		const patterns: WorkspaceFileAssociation[] = [];
		for (const node of snapshot.nodes) {
			const associations = Object.freeze([...node.files].sort(associationSort));
			byOwner.set(node.id, associations);
			for (const association of associations) {
				if (association.projectId) append(byProject, association.projectId, association);
				if (association.match === "exact") append(exact, association.path, association);
				else patterns.push(association);
			}
		}
		this.#associationIndex = Object.freeze({
			revision: snapshot.workspaceRevision,
			byOwner: readonlyMap(byOwner),
			byProject: readonlyMap(byProject),
			exact: readonlyMap(exact),
			patterns: Object.freeze(patterns.sort(associationSort)),
			support: this.#ownershipSupport(),
		});
		return this.#associationIndex;
	}

	#containedDescendants(root: string): readonly string[] {
		const result = new Set<string>();
		const queue = [root];
		while (queue.length && result.size < 500) {
			const current = queue.shift();
			if (current === undefined) break;
			for (const edge of this.sources.graph.edges("contains"))
				if (edge.from === current && !result.has(edge.to)) {
					result.add(edge.to);
					queue.push(edge.to);
				}
		}
		return [...result].sort();
	}

	#ownershipSupport(): "full" | "partial" | "unavailable" {
		if (this.sources.definition.executables.some(({ files }) => (files?.length ?? 0) > 0))
			return "full";
		if (
			(this.sources.contributions ?? []).some(({ facts }) =>
				facts.some(({ associations, resolve }) => (associations?.length ?? 0) > 0 || !!resolve),
			)
		)
			return "partial";
		return "unavailable";
	}

	queryNodes(query: NodeQuery): NodeQueryResult {
		const snapshot = this.describeWorkspace();
		const page = paginate(
			snapshot.nodes.filter(
				(node) =>
					(!query.kinds?.length || query.kinds.includes(node.kind)) &&
					(!query.lifecycleStates?.length ||
						(node.lifecycleState && query.lifecycleStates.includes(node.lifecycleState))) &&
					(!query.healthStates?.length ||
						(node.health && query.healthStates.includes(node.health.state))) &&
					(!query.projectIds?.length ||
						(node.projectId && query.projectIds.includes(node.projectId))),
			),
			query.limit,
			query.cursor,
		);
		return freeze({
			workspaceRevision: snapshot.workspaceRevision,
			nodes: page.items,
			...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
		});
	}

	analyzeChangeImpact(query: ChangeImpactQuery): ChangeImpactResult {
		if (!query.paths.length)
			throw intelligenceError("query.paths_required", "At least one changed path is required");
		const snapshot = this.describeWorkspace();
		const fileResult = this.queryFiles({
			paths: query.paths,
			includeGenerated: true,
			limit: 500,
		});
		const directFiles = fileResult.files;
		const directIds = new Set(directFiles.flatMap(({ owners }) => owners));
		const affectedIds = new Set(directIds);
		const classifications = new Map<string, Omit<WorkspaceImpactEntity, "evidenceIds">>();
		for (const id of directIds) {
			const node = snapshot.nodes.find((candidate) => candidate.id === id);
			if (!node) continue;
			const task = node.kind === "task";
			classifications.set(id, {
				id,
				kind: node.kind,
				name: node.name,
				relationship: task ? "validation-task" : "direct-owner",
				direct: true,
				path: [id],
				reason: task
					? "A declared task input matches the changed file"
					: "A file association directly matches the changed file",
				confidence: directFiles
					.filter(({ ownerId }) => ownerId === id)
					.some(({ confidence }) => confidence === "declared")
					? "declared"
					: "derived",
			});
		}
		const compositionQueue = [...directIds];
		while (compositionQueue.length) {
			const child = compositionQueue.shift();
			if (child === undefined) break;
			for (const edge of this.sources.graph.edges("contains"))
				if (
					edge.to === child &&
					this.sources.graph.node(edge.from)?.kind !== "workspace" &&
					!affectedIds.has(edge.from)
				) {
					affectedIds.add(edge.from);
					const parent = snapshot.nodes.find(({ id }) => id === edge.from);
					if (parent && !classifications.has(parent.id))
						classifications.set(parent.id, {
							id: parent.id,
							kind: parent.kind,
							name: parent.name,
							relationship: "composite-parent",
							direct: false,
							path: [child, parent.id],
							reason: `${parent.id} contains directly affected ${child}`,
							confidence: "derived",
						});
					compositionQueue.push(edge.from);
				}
		}
		for (const id of [...directIds]) {
			for (const node of this.queryGraph({
				roots: [id],
				direction: "dependents",
				depth: 32,
				limit: 500,
			}).nodes) {
				affectedIds.add(node.id);
				if (node.id === id || classifications.has(node.id)) continue;
				const relationship = node.kind === "task" ? "validation-task" : "dependent-runtime";
				classifications.set(node.id, {
					id: node.id,
					kind: node.kind,
					name: node.name,
					relationship,
					direct: false,
					path: [id, node.id],
					reason:
						node.kind === "task"
							? `${node.id} depends on a validation task affected by the changed file`
							: `${node.id} depends on directly affected ${id}`,
					confidence: "derived",
				});
			}
		}
		const affectedProjectRoots = snapshot.projects
			.filter(({ id }) => directFiles.some(({ projectIds }) => projectIds.includes(id)))
			.map(({ root }) => root);
		for (const edge of this.sources.graph.edges("produces"))
			if (affectedIds.has(edge.from)) {
				affectedIds.add(edge.to);
				const artifact = snapshot.nodes.find(({ id }) => id === edge.to);
				if (!artifact) continue;
				const paths = artifact.files.map(({ path }) => path);
				const precise = paths.some((artifactPath) =>
					affectedProjectRoots.some(
						(root) => artifactPath === root || artifactPath.startsWith(`${root}/`),
					),
				);
				const sameTopLevel = paths.some((artifactPath) =>
					query.paths.some(
						(changedPath) => artifactPath.split("/")[0] === changedPath.split("/")[0],
					),
				);
				classifications.set(edge.to, {
					id: edge.to,
					kind: artifact.kind,
					name: artifact.name,
					relationship: precise
						? "produced-artifact"
						: sameTopLevel
							? "potentially-affected"
							: "related",
					direct: false,
					path: [edge.from, edge.to],
					reason: precise
						? `${edge.from} produces an artifact scoped to an affected project`
						: `${edge.from} also declares this broader output`,
					confidence: precise ? "derived" : "inferred",
				});
			}
		const affectedNodes = snapshot.nodes.filter(({ id }) => affectedIds.has(id));
		const affectedTasks = affectedNodes.filter(({ kind }) => kind === "task");
		const projectIds = new Set(
			affectedNodes.flatMap(({ projectId }) => (projectId ? [projectId] : [])),
		);
		const entityEvidence: EvidenceRecord[] = [];
		const classifiedEntities = [...classifications.values()]
			.sort((left, right) => left.id.localeCompare(right.id))
			.map((entity) => {
				const records = entity.direct
					? directFiles
							.filter((file) => file.owners.includes(entity.id))
							.flatMap((file) =>
								file.evidence.map((item) => ({
									...item,
									reason: `${file.path} matches ${file.confidence} ${file.role} ownership for ${file.owners.join(", ")}`,
								})),
							)
					: [
							{
								type: "derived" as const,
								source: "system-graph",
								reason: entity.reason,
							},
						];
				entityEvidence.push(...records);
				return { ...entity, evidenceIds: records.map(evidenceRecordId).sort() };
			});
		const evidence = collectEvidence(entityEvidence);
		return freeze({
			workspaceRevision: snapshot.workspaceRevision,
			support: fileResult.support,
			entities: classifiedEntities,
			...(query.expand?.includes("files") ? { affectedFiles: directFiles } : {}),
			directOwnerIds: [...directIds].sort(),
			aggregateOwnerIds: affectedNodes
				.filter(({ id }) => !directIds.has(id))
				.map(({ id }) => id)
				.sort(),
			...(query.expand?.includes("projects")
				? { affectedProjects: snapshot.projects.filter(({ id }) => projectIds.has(id)) }
				: {}),
			...(query.expand?.includes("nodes")
				? {
						affectedNodes,
						affectedApplications: affectedNodes.filter(({ kind }) => kind === "application"),
						affectedProcesses: affectedNodes.filter(({ kind }) => kind === "process"),
					}
				: {}),
			...(query.expand?.includes("tasks") ? { affectedTasks } : {}),
			...(query.expand?.includes("artifacts")
				? { affectedArtifacts: affectedNodes.filter(({ kind }) => kind === "artifact") }
				: {}),
			recommendedValidations: affectedTasks.map(({ id }) => id).sort(),
			...(query.expand?.includes("evidence")
				? {
						evidence,
					}
				: {}),
			confidence: directFiles.some(({ confidence }) => confidence === "declared")
				? "declared"
				: directFiles.length
					? "derived"
					: "unknown",
			warnings: fileResult.warnings,
		});
	}

	recommendValidation(query: ChangeImpactQuery): ValidationRecommendationResult {
		const impact = this.analyzeChangeImpact({ ...query, expand: ["tasks", "evidence"] });
		const taskIds = (impact.affectedTasks ?? []).map(({ id }) => id);
		if (!taskIds.length)
			return freeze({
				workspaceRevision: impact.workspaceRevision,
				support: impact.support,
				recommendations: [],
				evidence: collectEvidence([]),
				warnings: [
					...impact.warnings,
					{
						code: "workspace.validation_unavailable",
						message: "No validation task is connected to the changed files by evidence",
					},
				],
			});
		const selected = new Set(taskIds);
		const order = this.sources.graph.plan(selected).order.filter((id) => selected.has(id));
		const recommendationEvidence = new Map<string, EvidenceRecord[]>();
		const recommendations = order.map((taskId) => {
			const direct = impact.directOwnerIds.includes(taskId);
			const records = direct
				? Object.values(impact.evidence?.records ?? {}).filter(({ reason }) =>
						reason.includes(taskId),
					)
				: [
						{
							type: "derived" as const,
							source: "system-graph",
							reason: `${taskId} depends on affected validation task${taskIds.length === 1 ? "" : "s"}`,
						},
					];
			recommendationEvidence.set(taskId, records);
			const prerequisites = this.sources.graph
				.dependencies(taskId)
				.filter(({ id, kind }) => kind === "task" && selected.has(id))
				.map(({ id }) => id)
				.sort();
			const covered = this.queryGraph({
				roots: [taskId],
				direction: "dependencies",
				depth: 32,
				limit: 500,
			})
				.nodes.filter(({ id, kind }) => kind === "task" && id !== taskId && selected.has(id))
				.map(({ id }) => id)
				.sort();
			return {
				taskId,
				reason: direct
					? "Task input directly matches a changed file"
					: "Task transitively validates an affected task through the configured task graph",
				confidence: direct ? impact.confidence : "derived",
				evidenceIds: records.map(evidenceRecordId).sort(),
				prerequisiteTaskIds: prerequisites,
				...(covered.length ? { coveredTaskIds: covered } : {}),
			};
		});
		return freeze({
			workspaceRevision: impact.workspaceRevision,
			support: impact.support,
			recommendations,
			evidence: collectEvidence([...recommendationEvidence.values()].flat()),
			warnings: impact.warnings,
		});
	}

	planCommand(command: ControlPlaneCommand): CommandPlan {
		const targets = commandTargets(command);
		const snapshot = this.describeWorkspace();
		const resolvedTargets = targets.filter((id) =>
			command.type === "operation.cancel"
				? this.sources.snapshot().operations.some(({ id: operationId }) => operationId === id)
				: snapshot.nodes.some(({ id: nodeId }) => nodeId === id),
		);
		const missing = targets.filter((id) => !resolvedTargets.includes(id));
		const direction = command.type === "node.stop" ? "dependents" : "dependencies";
		const selected =
			command.type === "node.start" ||
			command.type === "node.restart" ||
			command.type === "task.run"
				? selectStartClosure(this.sources.graph, resolvedTargets)
				: resolvedTargets.flatMap((id) =>
						this.queryGraph({ roots: [id], direction, depth: 32, limit: 500 }).nodes.map(
							({ id }) => id,
						),
					);
		const related = new Set(selected.filter((id) => !resolvedTargets.includes(id)));
		const affected = [...new Set([...resolvedTargets, ...related])].sort();
		const dependencyOrder = this.sources.graph.plan(affected).order;
		const permission = controlPlaneCommandPermission(command);
		const executableById = new Map(
			this.sources.definition.executables.map((item) => [item.id, item]),
		);
		const resources = affected
			.flatMap((id) => {
				const executable = executableById.get(id);
				if (executable?.healthcheck?.type === "tcp")
					return [
						`tcp:${executable.healthcheck.host ?? "localhost"}:${executable.healthcheck.port}`,
					];
				if (executable?.healthcheck?.type === "http") return [executable.healthcheck.url];
				return [];
			})
			.sort();
		const actionable = new Set(
			affected.filter((id) => {
				if (command.type === "operation.cancel") return id === command.operationId;
				const node = snapshot.nodes.find(({ id: nodeId }) => nodeId === id);
				if (command.type === "task.run") return node?.kind === "task";
				const executable = executableById.get(id);
				return !!executable?.command && node?.kind !== "task";
			}),
		);
		const executionOrder = dependencyOrder.filter((id) => actionable.has(id));
		const action: CommandPlan["actions"][number]["action"] =
			command.type === "node.stop"
				? "stop"
				: command.type === "node.restart"
					? "restart"
					: command.type === "task.run"
						? "run"
						: command.type === "operation.cancel"
							? "cancel"
							: "start";
		const actions = executionOrder.map((target) => ({
			id: `${action}:${target}`,
			action,
			target,
			prerequisite: !resolvedTargets.includes(target),
		}));
		return freeze({
			command,
			valid: missing.length === 0,
			requestedTargets: targets,
			expandedTargets: executionOrder,
			actions,
			prerequisiteActions: actions.filter(({ prerequisite }) => prerequisite).map(({ id }) => id),
			executionOrder: actions.map(({ id }) => id),
			readinessRequirements: this.sources.graph
				.edges("depends-on")
				.filter(({ from, to }) => affected.includes(from) && affected.includes(to))
				.map(({ from, to, condition }) => ({ from, to, ...(condition ? { condition } : {}) })),
			affectedNodes: affected,
			affectedProcesses: affected.filter(
				(id) => snapshot.nodes.find((node) => node.id === id)?.kind === "process",
			),
			resources,
			expectedArtifacts: snapshot.nodes
				.filter(({ id }) => affected.includes(id))
				.flatMap(({ artifacts }) => artifacts)
				.filter((id, index, values) => values.indexOf(id) === index)
				.sort(),
			requiredPermissions: [permission],
			risk: command.type === "node.stop" || command.type === "node.restart" ? "medium" : "low",
			warnings: missing.map((id) => `Target ${id} does not exist`),
			evidence: [
				{
					type: "derived",
					source: "system-graph",
					reason: `Resolved ${command.type} against the authoritative graph and live operation snapshot`,
				},
			],
		});
	}

	#neighbors(id: string, direction: GraphQuery["direction"]): readonly SystemNode[] {
		if (direction === "dependents") return this.sources.graph.consumers(id);
		if (direction === "both")
			return [...this.sources.graph.dependencies(id), ...this.sources.graph.consumers(id)].sort(
				byId,
			);
		return this.sources.graph.dependencies(id);
	}

	#resolveNodeId(value: string): { canonicalId: string; matchedAlias?: string } {
		if (this.sources.graph.node(value)) return { canonicalId: value };
		const suggestions = this.sources.graph
			.nodes()
			.map(({ id }) => id)
			.sort(
				(left, right) =>
					similarityRank(value, left) - similarityRank(value, right) || left.localeCompare(right),
			)
			.slice(0, 3);
		throw intelligenceError("workspace.node_not_found", `Workspace node ${value} was not found`, {
			requested: value,
			suggestions,
		});
	}

	#projects(): readonly ProjectDescription[] {
		return (this.sources.workspace?.packages ?? [])
			.map((item) => ({
				id: `package:${item.name}`,
				name: item.name,
				root: relative(this.sources.definition.root, item.root),
				kind: "package" as const,
				private: item.private,
				publishable: item.publishable,
				evidence: [
					{
						type: "manifest" as const,
						source: item.name,
						file: relative(this.sources.definition.root, item.manifestFile),
						reason: "Declared by a workspace package manifest",
					},
				],
			}))
			.sort(byId);
	}

	#node(
		node: SystemNode,
		live: ControlPlaneSnapshot,
		projects: readonly ProjectDescription[],
	): WorkspaceNodeDescription {
		const state = live.nodes.find((item) => item.id === node.id);
		const executable = this.sources.definition.executables.find((item) => item.id === node.id);
		const artifact = this.sources.definition.artifacts.find((item) => item.id === node.id);
		const artifactProducer = artifact?.producer
			? this.sources.definition.executables.find((item) => item.name === artifact.producer)
			: undefined;
		const artifactPaths = artifact
			? [
					...(artifact.location ? [artifact.location] : []),
					...(artifactProducer?.outputs
						.filter(({ artifact: name }) => name === artifact.name)
						.map(({ path: outputPath }) => outputPath) ?? []),
				].filter((value, index, values) => values.indexOf(value) === index)
			: [];
		const contributed = (this.sources.contributions ?? []).flatMap((contribution) =>
			contribution.facts.flatMap((fact) => {
				const selected =
					fact.selector.nodeId === node.id ||
					(fact.selector.provider !== undefined &&
						executable?.provider?.provider === fact.selector.provider);
				if (!selected) return [];
				const associations = [
					...(fact.associations ?? []),
					...(fact.resolve?.({
						nodeId: node.id,
						workspaceRoot: this.sources.definition.root,
						projectRoot: executable?.root ?? this.sources.definition.root,
						projectRelativeRoot: executable
							? relative(this.sources.definition.root, executable.root)
							: ".",
						providerOptions: executable?.provider?.options,
					}) ?? []),
				];
				return associations.map((association) => ({
					ownerId: node.id,
					ownerKind: node.kind,
					path: association.pattern.replaceAll("\\", "/").replace(/^\.\//, ""),
					match: workspacePatternKind(association.pattern),
					role: association.role,
					generated:
						association.generated ??
						(association.role === "generated" || association.role === "task-output"),
					contributionSources: [contribution.id],
					confidence: "derived" as const,
					evidence: [
						{
							type: "plugin" as const,
							source: contribution.owner.id,
							reason: `Contributed by ${contribution.id} (${contribution.category})`,
						},
					],
				}));
			}),
		);
		const projectOwner = executable ?? artifactProducer;
		const projectId = projects.find((project) =>
			projectOwner
				? isWithin(project.root, relative(this.sources.definition.root, projectOwner.root))
				: false,
		)?.id;
		const evidence: EvidenceRecord[] = executable
			? [
					{
						...configurationEvidence(this.sources.definition),
						reason: `Declared ${executable.kind} ${executable.name}`,
					},
				]
			: [
					{
						type: "derived",
						source: "system-graph",
						reason: "Composed from the normalized system graph",
					},
				];
		return {
			id: node.id,
			canonicalId: node.id,
			aliases: nodeAliases(node.id),
			...(nodeParentId(node.id) ? { parentId: nodeParentId(node.id) } : {}),
			kind: node.kind,
			name: node.name,
			...(projectId ? { projectId } : {}),
			...(state
				? {
						lifecycleState: state.state,
						health: {
							state: state.health,
							...(state.lastHealthDiagnostic ? { diagnostic: state.lastHealthDiagnostic } : {}),
						},
						runtime: {
							...(state.runtime ? { runtime: state.runtime } : {}),
							...(state.pid ? { processId: state.pid } : {}),
							state: state.state,
						},
					}
				: {}),
			files: uniqueAssociations([
				...(executable?.files ?? []).map((association) => ({
					ownerId: node.id,
					ownerKind: node.kind,
					...(projectId ? { projectId } : {}),
					path: association.pattern,
					match: workspacePatternKind(association.pattern),
					role: association.role,
					generated: association.generated,
					contributionSources: ["wsrt-config"],
					...(association.role === "task-output"
						? {
								producerId: node.id,
								consumerIds: executable.outputs
									.filter(({ path }) => path === association.pattern)
									.map(({ artifact: name }) => `artifact:${name}`),
							}
						: {}),
					confidence: "declared" as const,
					evidence: [
						{
							type: "configuration" as const,
							source: "wsrt-config",
							file: relative(this.sources.definition.root, association.source.file),
							...(association.source.line ? { line: association.source.line } : {}),
							reason: `Declared ${association.role} association at ${association.source.path}`,
						},
					],
				})),
				...artifactPaths.map((artifactPath) => ({
					ownerId: node.id,
					ownerKind: node.kind,
					...(projectId ? { projectId } : {}),
					path: artifactPath.replaceAll("\\", "/").replace(/^\.\//, ""),
					match: workspacePatternKind(artifactPath),
					role: "artifact" as const,
					generated: true,
					contributionSources: ["wsrt-config"],
					...(artifactProducer ? { producerId: artifactProducer.id } : {}),
					consumerIds: artifact.consumers.map(
						(name) =>
							this.sources.definition.executables.find((item) => item.name === name)?.id ?? name,
					),
					confidence: "declared" as const,
					evidence: [
						{
							type: "configuration" as const,
							source: "wsrt-config",
							file: relative(this.sources.definition.root, artifact.source.file),
							reason: `Declared artifact location at ${artifact.source.path}.location`,
						},
					],
				})),
				...contributed,
			]),
			artifacts: [
				...live.artifacts.filter((item) => item.producer === node.id).map((item) => item.id),
				...this.sources.definition.artifacts
					.filter((item) => executable && item.producer === executable.name)
					.map((item) => item.id),
			]
				.filter((id, index, values) => values.indexOf(id) === index)
				.sort(),
			prerequisiteTaskIds: this.sources.graph
				.dependencies(node.id)
				.filter(({ kind }) => kind === "task")
				.map(({ id }) => id)
				.sort(),
			operations: executable
				? ["node.start", "node.stop", "node.restart"].map((type) => ({ type, available: true }))
				: [],
			metadata: node.metadata ?? {},
			...(executable
				? { providerMetadata: providerMetadata(executable, this.sources.definition) }
				: {}),
			evidence,
		};
	}

	#relationships(configuration: EvidenceRecord): readonly WorkspaceRelationship[] {
		return this.sources.graph
			.edges()
			.map((edge) => ({
				from: edge.from,
				to: edge.to,
				kind: edge.kind,
				...(edge.condition ? { condition: edge.condition } : {}),
				metadata: edge.metadata ?? {},
				evidence: [{ ...configuration, reason: `Declared ${edge.kind} relationship` }],
			}))
			.sort(
				(a, b) =>
					a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind),
			);
	}

	#capabilities() {
		const features = this.sources.hostFeatures ?? {};
		const supportedNodeKinds = [
			...new Set(this.sources.graph.nodes().map(({ kind }) => kind)),
		].sort();
		const capability = (
			id: string,
			available: boolean,
			details?: Readonly<Record<string, unknown>>,
		) => ({ id, available, ...(details ? { details } : {}) });
		return [
			capability("workspace.description", true),
			capability("workspace.node-description", true),
			capability("workspace.get-started", true),
			capability("workspace.graph-query", true, { maximumDepth: 32, maximumResults: 500 }),
			capability("workspace.source-ownership", this.#ownershipSupport() !== "unavailable", {
				support: this.#ownershipSupport(),
			}),
			capability("runtime.state", true),
			capability("diagnostics", true),
			capability("logs", features.logs === true),
			capability("operations", true),
			capability("workspace.change-impact", features.changeImpact === true),
			capability("workspace.command-planning", features.commandPlanning === true),
			capability("workspace.command-execution", features.commandExecution === true),
			capability("subscriptions", features.subscriptions === true),
			capability("workspace.node-kinds", true, { supported: supportedNodeKinds }),
			capability("workspace.protocol", features.protocolVersion !== undefined, {
				...(features.protocolVersion !== undefined ? { version: features.protocolVersion } : {}),
			}),
			capability("workspace.transports", (features.transports?.length ?? 0) > 0, {
				supported: [...(features.transports ?? [])].sort(),
			}),
			capability("workspace.permissions", (features.permissions?.length ?? 0) > 0, {
				supported: [...(features.permissions ?? [])].sort(),
			}),
		].sort(byId);
	}
}

function providerMetadata(
	executable: NormalizedSystemDefinition["executables"][number],
	definition: NormalizedSystemDefinition,
) {
	const health = executable.healthcheck;
	const urls = health?.type === "http" ? [health.url] : [];
	const ports =
		health?.type === "tcp"
			? [health.port]
			: urls
					.flatMap((value) => {
						try {
							return [Number(new URL(value).port)];
						} catch {
							return [];
						}
					})
					.filter((value) => Number.isInteger(value) && value > 0);
	return {
		...(executable.provider?.provider ? { provider: executable.provider.provider } : {}),
		runtimeId: executable.runtime,
		...(executable.command
			? { command: executable.command.command, arguments: executable.command.args }
			: {}),
		workingDirectory: relative(definition.root, executable.root),
		...(ports.length ? { ports } : {}),
		...(urls.length ? { urls } : {}),
		...(health ? { readiness: health, healthCheck: health } : {}),
		entrypoints: (executable.files ?? [])
			.filter(({ role }) => role === "entrypoint")
			.map(({ pattern }) => pattern),
		configurationFiles: (executable.files ?? [])
			.filter(({ role }) => role === "configuration")
			.map(({ pattern }) => pattern),
		outputPatterns: (executable.files ?? [])
			.filter(({ role }) => role === "task-output" || role === "generated")
			.map(({ pattern }) => pattern),
		artifactIds: (definition.artifacts ?? [])
			.filter(({ producer }) => producer === executable.name)
			.map(({ id }) => id)
			.sort(),
		environmentVariableNames: Object.keys(executable.environment ?? {}).sort(),
		evidence: [
			{
				...configurationEvidence(definition),
				reason: `Normalized safe provider metadata for ${executable.id}`,
			},
		],
	};
}

function configurationEvidence(definition: NormalizedSystemDefinition): EvidenceRecord {
	return {
		type: "configuration",
		source: "wsrt-config",
		file: relative(definition.root, definition.sourceFile),
		reason: "Declared by normalized workspace configuration",
	};
}

function relative(root: string, value: string): string {
	return path.relative(root, value).replaceAll(path.sep, "/") || ".";
}

function isWithin(root: string, value: string): boolean {
	return root === "." || value === root || value.startsWith(`${root}/`);
}

function byId<T extends { id: string }>(left: T, right: T): number {
	return left.id.localeCompare(right.id);
}

function freeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const item of Object.values(value)) freeze(item);
	}
	return value;
}

function intelligenceError(
	code: string,
	message: string,
	details?: Readonly<Record<string, unknown>>,
): Error & { code: string; details?: Readonly<Record<string, unknown>> } {
	return Object.assign(new Error(message), { code, ...(details ? { details } : {}) });
}

function nodeAliases(id: string): readonly string[] {
	void id;
	return [];
}

function nodeParentId(id: string): string | undefined {
	const match = /^(application:[^/]+)\/process:.+$/.exec(id);
	return match?.[1];
}

function similarityRank(requested: string, candidate: string): number {
	const requestedParts = new Set(requested.split(/[:/.-]/).filter(Boolean));
	const shared = candidate
		.split(/[:/.-]/)
		.filter(Boolean)
		.filter((part) => requestedParts.has(part)).length;
	return -shared * 100 + Math.abs(candidate.length - requested.length);
}

const DEFAULT_PAGE_LIMIT = 100;

const MAX_PAGE_LIMIT = 500;

function paginate<T>(
	items: readonly T[],
	requestedLimit?: number,
	cursor?: string,
): { items: readonly T[]; nextCursor?: string } {
	const limit = integer(requestedLimit ?? DEFAULT_PAGE_LIMIT, "limit", 1, MAX_PAGE_LIMIT);
	const offset = cursor ? decodeCursor(cursor) : 0;
	if (offset > items.length)
		throw intelligenceError("query.invalid_cursor", "Query cursor is outside the result set");
	const page = items.slice(offset, offset + limit);
	const next = offset + page.length;
	return { items: page, ...(next < items.length ? { nextCursor: encodeCursor(next) } : {}) };
}

function integer(value: number, name: string, minimum: number, maximum: number): number {
	if (!Number.isInteger(value) || value < minimum || value > maximum)
		throw intelligenceError(
			name === "limit" ? "query.limit_invalid" : "query.depth_invalid",
			`${name} must be an integer between ${minimum} and ${maximum}`,
		);
	return value;
}

function encodeCursor(offset: number): string {
	return Buffer.from(JSON.stringify({ version: 1, offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): number {
	try {
		const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
		if (
			!value ||
			typeof value !== "object" ||
			(value as { version?: unknown }).version !== 1 ||
			!Number.isInteger((value as { offset?: unknown }).offset) ||
			((value as { offset: number }).offset ?? -1) < 0
		)
			throw new Error("invalid");
		return (value as { offset: number }).offset;
	} catch {
		throw intelligenceError("query.invalid_cursor", "Query cursor is invalid");
	}
}

function commandTargets(command: ControlPlaneCommand): string[] {
	if ("nodeIds" in command) return command.nodeIds.map(canonicalProcessId);
	if (command.type === "task.run")
		return [command.taskId.startsWith("task:") ? command.taskId : `task:${command.taskId}`];
	return [command.operationId];
}

function canonicalQueryPath(value: string): string {
	try {
		return normalizeWorkspaceRelativePath(value);
	} catch {
		throw intelligenceError(
			"query.path_invalid",
			`Workspace path must be relative and cannot escape the workspace: ${value}`,
		);
	}
}

type AssociationIndex = Readonly<{
	revision: number;
	byOwner: ReadonlyMap<string, readonly WorkspaceFileAssociation[]>;
	byProject: ReadonlyMap<string, readonly WorkspaceFileAssociation[]>;
	exact: ReadonlyMap<string, readonly WorkspaceFileAssociation[]>;
	patterns: readonly WorkspaceFileAssociation[];
	support: "full" | "partial" | "unavailable";
}>;

function append(
	target: Map<string, WorkspaceFileAssociation[]>,
	key: string,
	association: WorkspaceFileAssociation,
): void {
	const values = target.get(key) ?? [];
	values.push(association);
	target.set(key, values);
}

function readonlyMap(
	value: Map<string, WorkspaceFileAssociation[] | readonly WorkspaceFileAssociation[]>,
): ReadonlyMap<string, readonly WorkspaceFileAssociation[]> {
	return new Map(
		[...value.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, associations]) => [key, Object.freeze([...associations].sort(associationSort))]),
	);
}

function associationSort(left: WorkspaceFileAssociation, right: WorkspaceFileAssociation): number {
	return (
		left.ownerId.localeCompare(right.ownerId) ||
		left.path.localeCompare(right.path) ||
		left.role.localeCompare(right.role)
	);
}

function uniqueAssociations(
	associations: readonly WorkspaceFileAssociation[],
): readonly WorkspaceFileAssociation[] {
	const values = new Map<string, WorkspaceFileAssociation>();
	for (const association of associations) {
		const key = `${association.ownerId}\0${association.path}\0${association.role}`;
		const current = values.get(key);
		if (!current) {
			values.set(key, association);
			continue;
		}
		const strongest =
			confidenceRank(association.confidence) > confidenceRank(current.confidence)
				? association
				: current;
		values.set(key, {
			...strongest,
			generated: current.generated || association.generated,
			contributionSources: [
				...new Set([...current.contributionSources, ...association.contributionSources]),
			].sort(),
			evidence: [...current.evidence, ...association.evidence]
				.filter(
					(item, index, all) =>
						all.findIndex(
							(candidate) =>
								`${candidate.type}\0${candidate.source}\0${candidate.reason}` ===
								`${item.type}\0${item.source}\0${item.reason}`,
						) === index,
				)
				.sort((left, right) =>
					`${left.source}:${left.reason}`.localeCompare(`${right.source}:${right.reason}`),
				),
			consumerIds: [
				...new Set([...(current.consumerIds ?? []), ...(association.consumerIds ?? [])]),
			].sort(),
		});
	}
	return [...values.values()].sort(associationSort);
}

function confidenceRank(value: WorkspaceFileAssociation["confidence"]): number {
	return { unknown: 0, inferred: 1, derived: 2, declared: 3 }[value];
}

function evidenceRecordKey(record: EvidenceRecord): string {
	return JSON.stringify([
		record.type,
		record.source,
		record.file ?? null,
		record.line ?? null,
		record.reason,
	]);
}

function evidenceRecordId(record: EvidenceRecord): string {
	let hash = 0x811c9dc5;
	for (const character of evidenceRecordKey(record)) {
		hash ^= character.charCodeAt(0);
		hash = Math.imul(hash, 0x01000193);
	}
	return `evidence:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function collectEvidence(records: readonly EvidenceRecord[]): EvidenceCollection {
	const entries = new Map<string, EvidenceRecord>();
	for (const record of records) {
		const id = evidenceRecordId(record);
		const existing = entries.get(id);
		if (existing && evidenceRecordKey(existing) !== evidenceRecordKey(record))
			throw new Error(`Evidence identifier collision for ${id}`);
		entries.set(id, record);
	}
	return {
		records: Object.fromEntries([...entries].sort(([left], [right]) => left.localeCompare(right))),
	};
}
