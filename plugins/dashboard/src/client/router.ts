import type { DashboardRoute } from "../shared/contracts.js";

const routes = new Set<DashboardRoute>([
	"overview",
	"graph",
	"nodes",
	"operations",
	"artifacts",
	"events",
	"diagnostics",
	"plugins",
	"configuration",
]);
export function matchDashboardRoute(pathname: string): DashboardRoute {
	const value = pathname.replace(/^\/+|\/+$/g, "") || "overview";
	return routes.has(value as DashboardRoute)
		? (value as DashboardRoute)
		: "overview";
}
export class DashboardRouter {
	constructor(readonly onRoute: (route: DashboardRoute) => void) {}
	start() {
		const update = () => this.onRoute(matchDashboardRoute(location.pathname));
		addEventListener("popstate", update);
		update();
		return () => removeEventListener("popstate", update);
	}
	navigate(route: DashboardRoute) {
		history.pushState({}, "", `/${route}`);
		this.onRoute(route);
	}
}
