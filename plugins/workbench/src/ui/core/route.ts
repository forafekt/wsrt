export type RouteId =
	| "overview"
	| "architecture"
	| "projects"
	| "nodes"
	| "files"
	| "impact"
	| "validation"
	| "runtime"
	| "operations"
	| "diagnostics"
	| "artifacts"
	| "sessions"
	| "settings"
	| "not-found";

export type RouteTarget = Readonly<{
	id: RouteId;
	params?: Readonly<Record<string, string>>;
	query?: URLSearchParams;
}>;

export const routeDefinitions = [
	{ id: "overview", path: "/" },
	{ id: "architecture", path: "/architecture" },
	{ id: "projects", path: "/projects" },
	{ id: "projects", path: "/projects/:projectId" },
	{ id: "nodes", path: "/nodes" },
	{ id: "nodes", path: "/nodes/:nodeId" },
	{ id: "files", path: "/files" },
	{ id: "impact", path: "/impact" },
	{ id: "validation", path: "/validation" },
	{ id: "runtime", path: "/runtime" },
	{ id: "operations", path: "/operations" },
	{ id: "operations", path: "/operations/:operationId" },
	{ id: "diagnostics", path: "/diagnostics" },
	{ id: "artifacts", path: "/artifacts" },
	{ id: "artifacts", path: "/artifacts/:artifactId" },
	{ id: "sessions", path: "/sessions" },
	{ id: "settings", path: "/settings" },
] as const satisfies readonly { id: RouteId; path: string }[];

export function routePath(route: RouteTarget): string {
	const segment = route.id === "overview" ? "" : route.id;
	const id =
		route.params?.projectId ??
		route.params?.nodeId ??
		route.params?.operationId ??
		route.params?.artifactId;
	const path = id ? `/${segment}/${encodeURIComponent(id)}` : `/${segment}`;
	const query = route.query?.toString();
	return query ? `${path}?${query}` : path;
}
