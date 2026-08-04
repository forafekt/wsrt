import { dispatch } from "./dom.js";
import type { RouteId, RouteTarget } from "./route.js";
import { routePath } from "./route.js";

const routeIds = new Set<RouteId>([
	"overview",
	"architecture",
	"projects",
	"nodes",
	"files",
	"impact",
	"validation",
	"runtime",
	"operations",
	"diagnostics",
	"artifacts",
	"sessions",
	"settings",
]);

export class WorkbenchRouter {
	#dispose?: () => void;
	constructor(
		readonly basePath: string,
		readonly onRoute: (route: RouteTarget) => void,
	) {}
	start() {
		const update = () => this.onRoute(this.match(location.pathname, location.search));
		addEventListener("popstate", update);
		this.#dispose = () => removeEventListener("popstate", update);
		update();
		return this.#dispose;
	}
	stop() {
		this.#dispose?.();
	}
	navigate(route: RouteTarget, replace = false) {
		const path = `${this.basePath}${routePath(route)}`.replace(/\/{2,}/g, "/");
		history[replace ? "replaceState" : "pushState"]({}, "", path);
		this.onRoute(route);
	}
	match(pathname: string, search = ""): RouteTarget {
		const relative =
			this.basePath && pathname.startsWith(this.basePath)
				? pathname.slice(this.basePath.length)
				: pathname;
		const [first = "", second] = relative.replace(/^\/+|\/+$/g, "").split("/");
		const id = first ? (first as RouteId) : "overview";
		if (!routeIds.has(id)) return { id: "not-found", query: new URLSearchParams(search) };
		const params = second ? paramFor(id, decodeURIComponent(second)) : undefined;
		return { id, params, query: new URLSearchParams(search) };
	}
}

export class WorkbenchRouterElement extends HTMLElement {
	route?: RouteTarget;
	static define() {
		if (!customElements.get("wsrt-workbench-router"))
			customElements.define("wsrt-workbench-router", WorkbenchRouterElement);
	}
	connectedCallback() {
		this.setAttribute("role", "presentation");
	}
	navigate(route: RouteTarget) {
		dispatch(this, "wsrt:navigate", route);
	}
}

function paramFor(id: RouteId, value: string) {
	if (id === "projects") return { projectId: value };
	if (id === "nodes") return { nodeId: value };
	if (id === "operations") return { operationId: value };
	if (id === "artifacts") return { artifactId: value };
	return undefined;
}
