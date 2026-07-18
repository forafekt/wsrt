import type { DashboardRoute } from "../shared/contracts.js";

const routes = new Set<DashboardRoute>([
	"overview",
	"workspace",
	"graph",
	"nodes",
	"operations",
	"tasks",
	"artifacts",
	"events",
	"logs",
	"diagnostics",
	"health",
	"plugins",
	"providers",
	"configuration",
	"metrics",
	"timeline",
	"settings",
]);
export function matchDashboardRoute(pathname: string): DashboardRoute {
	const base =
		typeof document === "undefined"
			? ""
			: (document.querySelector<HTMLMetaElement>('meta[name="wsrt-base-path"]')
					?.content ?? "");
	const relative =
		base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
	const value = relative.replace(/^\/+|\/+$/g, "").split("/")[0] || "overview";
	return routes.has(value as DashboardRoute)
		? (value as DashboardRoute)
		: value.startsWith("ext:")
			? (`ext:${value.slice(4)}` as DashboardRoute)
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
		const base =
			document.querySelector<HTMLMetaElement>('meta[name="wsrt-base-path"]')
				?.content ?? "";
		history.pushState({}, "", `${base}/${route === "overview" ? "" : route}`);
		this.onRoute(route);
	}
}
