import type { DashboardRoute } from "../shared/contracts.js";
import { renderPage } from "./pages/index.js";
import { DashboardRouter } from "./router.js";
import { DashboardStore } from "./state/store.js";
import { SnapshotTransport } from "./transport/sse.js";

export function mountDashboard(root: HTMLElement) {
	const store = new DashboardStore();
	let route: DashboardRoute = "overview";
	let graphScale = 1;
	const render = () => {
		const base =
			document.querySelector<HTMLMetaElement>('meta[name="wsrt-base-path"]')
				?.content ?? "";
		root.innerHTML = `<header><strong>WSRT</strong><span aria-live="polite">${store.state.connected ? "Connected" : "Disconnected"}</span><nav aria-label="Dashboard">${["overview", "graph", "nodes", "operations", "artifacts", "events", "diagnostics", "plugins", "configuration"].map((item) => `<a href="${base}/${item === "overview" ? "" : item}" data-route="${item}" ${route === item ? 'aria-current="page"' : ""}>${item}</a>`).join("")}</nav><button id="refresh">Refresh</button><button id="theme" aria-label="Toggle theme">Theme</button></header><main>${renderPage(route, store.state)}</main>`;
	};
	const router = new DashboardRouter((next) => {
		route = next;
		render();
	});
	root.addEventListener("click", (event) => {
		const target = event.target as HTMLElement;
		const link = target.closest<HTMLAnchorElement>("[data-route]");
		if (link) {
			event.preventDefault();
			router.navigate(link.dataset.route as DashboardRoute);
		}
		const node = target.closest<HTMLElement>("[data-node]");
		if (node) store.dispatch({ type: "select-node", id: node.dataset.node });
		if (target.id === "theme")
			document.documentElement.classList.toggle("dark");
		if (target.id === "refresh") void transport.refresh();
		const graphAction =
			target.closest<HTMLElement>("[data-graph]")?.dataset.graph;
		if (graphAction) {
			graphScale =
				graphAction === "fit"
					? 1
					: Math.min(
							2.5,
							Math.max(
								0.35,
								graphScale + (graphAction === "in" ? 0.15 : -0.15),
							),
						);
			const viewport = root.querySelector<SVGGElement>("#graph-viewport");
			if (viewport) viewport.style.transform = `scale(${graphScale})`;
		}
	});
	root.addEventListener("input", (event) => {
		const target = event.target as HTMLInputElement;
		if (target.id === "event-filter")
			store.dispatch({ type: "filter-events", value: target.value });
	});
	const unsubscribe = store.subscribe(render),
		stopRouter = router.start(),
		transport = new SnapshotTransport(
			(snapshot) => store.dispatch({ type: "snapshot", snapshot }),
			(value) => store.dispatch({ type: "connected", value }),
		);
	void transport.start();
	return () => {
		transport.close();
		stopRouter();
		unsubscribe();
	};
}

if (typeof document !== "undefined") {
	const root = document.querySelector<HTMLElement>("#app");
	if (root) mountDashboard(root);
}
