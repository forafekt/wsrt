import type { DashboardRoute } from "../shared/contracts.js";
import { renderPage } from "./pages/index.js";
import { DashboardRouter } from "./router.js";
import { DashboardStore } from "./state/store.js";
import { SnapshotTransport } from "./transport/sse.js";

export function mountDashboard(root: HTMLElement) {
	const store = new DashboardStore();
	let route: DashboardRoute = "overview";
	const render = () => {
		root.innerHTML = `<header><strong>WSRT</strong><nav>${["overview", "graph", "nodes", "operations", "artifacts", "events", "diagnostics", "plugins", "configuration"].map((item) => `<a href="/${item}" data-route="${item}">${item}</a>`).join("")}</nav><button id="theme">Theme</button></header><main>${renderPage(route, store.state)}</main>`;
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
