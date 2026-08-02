import path from "node:path";
import type { NormalizedSystemDefinition } from "@wsrt/config";
import {
	type ControlPlaneCommand,
	type ControlPlaneSnapshot,
	controlPlaneCommandPermission,
} from "@wsrt/control-plane";
import type { SystemGraph, SystemNode } from "@wsrt/graph";
import type { WorkspaceIntelligenceContribution } from "@wsrt/plugins";
import type { ResolvedWorkspace } from "@wsrt/workspace";
import { matchesWorkspacePattern } from "@wsrt/workspace";
import {
	type ChangeImpactQuery,
	type ChangeImpactResult,
	type CommandPlan,
	type EvidenceRecord,
	type FileQuery,
	type FileQueryResult,
	type GraphQuery,
	type GraphQueryResult,
	type NodeQuery,
	type NodeQueryResult,
	type ProjectDescription,
	WORKSPACE_INTELLIGENCE_SCHEMA_VERSION,
	type WorkspaceFileAssociation,
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

	describeNode(id: string): WorkspaceNodeDescription {
		const node = this.sources.graph.node(id);
		if (!node)
			throw intelligenceError("workspace.node_not_found", `Workspace node ${id} was not found`);
		const projects = this.#projects();
		return freeze(this.#node(node, this.sources.snapshot(), projects));
	}

	queryGraph(query: GraphQuery): GraphQueryResult {
		const snapshot = this.describeWorkspace();
		if (!query.roots.length)
			throw intelligenceError("query.roots_required", "At least one graph root is required");
		const depth = integer(query.depth ?? 1, "depth", 0, 32);
		const limit = integer(query.limit ?? 100, "limit", 1, 500);
		for (const root of query.roots)
			if (!this.sources.graph.node(root))
				throw intelligenceError("workspace.node_not_found", `Workspace node ${root} was not found`);
		const ids = new Set<string>();
		let frontier = [...new Set(query.roots)].sort();
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
		const owners = snapshot.nodes.filter(
			(node) =>
				(!query.nodeIds?.length || query.nodeIds.includes(node.id)) &&
				(!query.projectIds?.length ||
					(node.projectId && query.projectIds.includes(node.projectId))),
		);
		const files = new Map<
			string,
			{ association: WorkspaceFileAssociation; owners: string[]; projects: string[] }
		>();
		for (const owner of owners)
			for (const association of owner.files) {
				if (query.roles?.length && !query.roles.includes(association.role)) continue;
				if (!query.includeGenerated && association.generated) continue;
				const matchedPaths = query.paths?.length
					? query.paths.filter((candidate) => matchesWorkspacePattern(candidate, association.path))
					: [association.path];
				for (const matchedPath of matchedPaths) {
					const resolved =
						matchedPath === association.path ? association : { ...association, path: matchedPath };
					const key = `${resolved.path}\0${resolved.role}`;
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
					owners: [...new Set(nodeOwners)].sort(),
					projectIds: [...new Set(projects)].sort(),
				}))
				.sort((a, b) => a.path.localeCompare(b.path) || a.role.localeCompare(b.role)),
			query.limit,
			query.cursor,
		);
		return freeze({
			workspaceRevision: snapshot.workspaceRevision,
			files: page.items,
			...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
		});
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
		const directFiles = this.queryFiles({
			paths: query.paths,
			includeGenerated: true,
			limit: 500,
		}).files;
		const directIds = new Set(directFiles.flatMap(({ owners }) => owners));
		const affectedIds = new Set(directIds);
		for (const id of [...directIds])
			for (const node of this.queryGraph({
				roots: [id],
				direction: "dependents",
				depth: 32,
				limit: 500,
			}).nodes)
				affectedIds.add(node.id);
		const affectedNodes = snapshot.nodes.filter(({ id }) => affectedIds.has(id));
		const affectedTasks = affectedNodes.filter(({ kind }) => kind === "task");
		const projectIds = new Set(
			affectedNodes.flatMap(({ projectId }) => (projectId ? [projectId] : [])),
		);
		const evidence: EvidenceRecord[] = directFiles.flatMap((file) =>
			file.evidence.map((item) => ({
				...item,
				reason: `${file.path} matches declared ${file.role} ownership for ${file.owners.join(", ")}`,
			})),
		);
		for (const node of affectedNodes)
			if (!directIds.has(node.id))
				evidence.push({
					type: "derived",
					source: "system-graph",
					reason: `${node.id} depends transitively on a directly affected node`,
				});
		return freeze({
			workspaceRevision: snapshot.workspaceRevision,
			affectedProjects: snapshot.projects.filter(({ id }) => projectIds.has(id)),
			affectedNodes,
			affectedTasks,
			recommendedValidations: affectedTasks.map(({ id }) => id).sort(),
			evidence: evidence.sort((a, b) =>
				`${a.source}:${a.reason}`.localeCompare(`${b.source}:${b.reason}`),
			),
			confidence: directFiles.length ? "declared" : "unknown",
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
		const related = new Set<string>();
		for (const id of resolvedTargets)
			if (command.type.startsWith("node.") || command.type === "task.run")
				for (const node of this.queryGraph({ roots: [id], direction, depth: 32, limit: 500 }).nodes)
					if (node.id !== id) related.add(node.id);
		const affected = [...new Set([...resolvedTargets, ...related])].sort();
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
				if (executable?.healthcheck?.type === "http") return [`http:${executable.healthcheck.url}`];
				return [];
			})
			.sort();
		return freeze({
			command,
			valid: missing.length === 0,
			resolvedTargets,
			dependencyActions: [...related].sort().map((target) => ({ action: direction, target })),
			affectedProcesses: affected.filter(
				(id) => snapshot.nodes.find((node) => node.id === id)?.kind !== "artifact",
			),
			resources,
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
		const contributed = (this.sources.contributions ?? []).flatMap((contribution) =>
			contribution.facts.flatMap((fact) => {
				const selected =
					fact.selector.nodeId === node.id ||
					(fact.selector.provider !== undefined &&
						executable?.provider?.provider === fact.selector.provider);
				if (!selected) return [];
				return fact.associations.map((association) => ({
					path: association.pattern.replaceAll("\\", "/").replace(/^\.\//, ""),
					role: association.role,
					generated:
						association.generated ??
						(association.role === "generated" || association.role === "task-output"),
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
		const projectId = projects.find((project) =>
			executable
				? isWithin(project.root, relative(this.sources.definition.root, executable.root))
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
			files: [
				...(executable?.files ?? []).map((association) => ({
					path: association.pattern,
					role: association.role,
					generated: association.generated,
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
				...contributed,
			].sort((a, b) => a.path.localeCompare(b.path) || a.role.localeCompare(b.role)),
			artifacts: live.artifacts
				.filter((item) => item.producer === node.id)
				.map((item) => item.id)
				.sort(),
			operations: executable
				? ["node.start", "node.stop", "node.restart"].map((type) => ({ type, available: true }))
				: [],
			metadata: node.metadata ?? {},
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
			capability("workspace.graph-query", true, { maximumDepth: 32, maximumResults: 500 }),
			capability(
				"workspace.source-ownership",
				this.sources.definition.executables.some(({ files }) => (files?.length ?? 0) > 0),
			),
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

function intelligenceError(code: string, message: string): Error & { code: string } {
	return Object.assign(new Error(message), { code });
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
	if ("nodeIds" in command) return [...command.nodeIds];
	if (command.type === "task.run")
		return [command.taskId.startsWith("task:") ? command.taskId : `task:${command.taskId}`];
	return [command.operationId];
}
