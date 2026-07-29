export const nodeKinds = [
	"workspace",
	"application",
	"service",
	"process",
	"worker",
	"package",
	"resource",
	"task",
	"artifact",
	"environment",
	"pipeline",
	"deployment",
] as const;

export type SystemNodeKind = (typeof nodeKinds)[number];

export type NodeHealth = "unknown" | "healthy" | "degraded" | "unhealthy";

export type SystemNode = {
	id: string;
	kind: SystemNodeKind;
	name: string;
	state?: string;
	health?: NodeHealth;
	metadata?: Readonly<Record<string, unknown>>;
	capabilities?: readonly string[];
};

export const edgeKinds = [
	"contains",
	"depends-on",
	"produces",
	"consumes",
	"generates",
	"hosts",
	"deploys",
	"observes",
	"activates",
] as const;

export type SystemEdgeKind = (typeof edgeKinds)[number];

export type DependencyCondition = "started" | "ready" | "healthy" | "completed" | "successful";

/**
 * Condition applied to a dependency that declares none. Readiness is the
 * conservative default: a dependant starts once its dependency is usable.
 */
export const defaultDependencyCondition: DependencyCondition = "ready";

export type SystemEdge = {
	from: string;
	to: string;
	kind: SystemEdgeKind;
	condition?: DependencyCondition;
	metadata?: Readonly<Record<string, unknown>>;
};

export type GraphIssue = {
	code: "duplicate-node" | "missing-node" | "cycle";
	message: string;
	path: readonly string[];
};

export type ExecutionPlan = {
	order: readonly string[];
	stages: readonly (readonly string[])[];
};

export class SystemGraph {
	readonly #nodes = new Map<string, SystemNode>();
	readonly #edges: SystemEdge[] = [];

	constructor(nodes: Iterable<SystemNode> = [], edges: Iterable<SystemEdge> = []) {
		for (const node of nodes) this.addNode(node);
		for (const edge of edges) this.addEdge(edge);
	}

	addNode(node: SystemNode): this {
		if (this.#nodes.has(node.id)) throw new Error(`Duplicate graph node: ${node.id}`);
		this.#nodes.set(node.id, Object.freeze({ ...node }));
		return this;
	}

	addEdge(edge: SystemEdge): this {
		this.#edges.push(Object.freeze({ ...edge }));
		return this;
	}
	node(id: string): SystemNode | undefined {
		return this.#nodes.get(id);
	}
	nodes(kind?: SystemNodeKind): readonly SystemNode[] {
		return [...this.#nodes.values()].filter((node) => !kind || node.kind === kind);
	}
	edges(kind?: SystemEdgeKind): readonly SystemEdge[] {
		return this.#edges.filter((edge) => !kind || edge.kind === kind);
	}
	dependencies(id: string): readonly SystemNode[] {
		return this.neighbors(id, "out", "depends-on");
	}
	/** Dependency edges of `id`, preserving the declared condition each one gates on. */
	dependencyEdges(id: string): readonly SystemEdge[] {
		return this.#edges.filter((edge) => edge.kind === "depends-on" && edge.from === id);
	}
	consumers(id: string): readonly SystemNode[] {
		return this.neighbors(id, "in", "depends-on");
	}

	neighbors(
		id: string,
		direction: "in" | "out" = "out",
		kind?: SystemEdgeKind,
	): readonly SystemNode[] {
		return this.#edges
			.filter(
				(edge) =>
					(!kind || edge.kind === kind) &&
					(direction === "out" ? edge.from === id : edge.to === id),
			)
			.map((edge) => this.#nodes.get(direction === "out" ? edge.to : edge.from))
			.filter((node): node is SystemNode => Boolean(node));
	}

	validate(): readonly GraphIssue[] {
		const issues: GraphIssue[] = [];
		for (const edge of this.#edges)
			for (const id of [edge.from, edge.to])
				if (!this.#nodes.has(id))
					issues.push({
						code: "missing-node",
						message: `Edge ${edge.from} -> ${edge.to} references missing node ${id}`,
						path: [edge.from, edge.to],
					});
		try {
			this.plan();
		} catch (cause) {
			issues.push({
				code: "cycle",
				message: cause instanceof Error ? cause.message : String(cause),
				path: [],
			});
		}
		return issues;
	}

	plan(selection: Iterable<string> = this.#nodes.keys()): ExecutionPlan {
		const selected = new Set(selection);
		const executableEdges = this.#edges.filter(
			(edge) => edge.kind === "depends-on" && selected.has(edge.from) && selected.has(edge.to),
		);
		const remaining = new Map(
			[...selected].map((id) => [id, executableEdges.filter((edge) => edge.from === id).length]),
		);
		const stages: string[][] = [];
		while (remaining.size) {
			const stage = [...remaining]
				.filter(([, count]) => count === 0)
				.map(([id]) => id)
				.sort();
			if (!stage.length)
				throw new Error(
					`Dependency cycle detected among: ${[...remaining.keys()].sort().join(", ")}`,
				);
			stages.push(stage);
			for (const id of stage) remaining.delete(id);
			for (const edge of executableEdges)
				if (stage.includes(edge.to) && remaining.has(edge.from))
					remaining.set(edge.from, (remaining.get(edge.from) ?? 0) - 1);
		}
		return { stages, order: stages.flat() };
	}

	shutdownPlan(selection?: Iterable<string>): ExecutionPlan {
		const plan = this.plan(selection);
		const stages = [...plan.stages].reverse().map((stage) => [...stage].reverse());
		return { stages, order: stages.flat() };
	}

	toJSON(): { nodes: readonly SystemNode[]; edges: readonly SystemEdge[] } {
		return { nodes: this.nodes(), edges: this.edges() };
	}
}

export type WorkspacePackageDescriptor = {
	name: string;
	root: string;
	dependencies: readonly string[];
};

export type WorkspaceDependencyGraph = {
	nodes: { id: string; root: string }[];
	edges: { from: string; to: string; type: "workspace" | "external" }[];
};

/** Builds the package-discovery projection used while compiling a full SystemGraph. */
export function buildWorkspaceGraph(
	packages: readonly WorkspacePackageDescriptor[],
	includeExternal = false,
): WorkspaceDependencyGraph {
	const names = new Set(packages.map((item) => item.name));
	return {
		nodes: packages.map((item) => ({ id: item.name, root: item.root })),
		edges: packages.flatMap((item) =>
			item.dependencies
				.filter((dependency) => includeExternal || names.has(dependency))
				.map((dependency) => ({
					from: item.name,
					to: dependency,
					type: names.has(dependency) ? ("workspace" as const) : ("external" as const),
				})),
		),
	};
}
