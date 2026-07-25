import type { DashboardRoute } from "../shared/contracts.js";
import { applyContributionSurfaces } from "./contributions.js";
import { WorkbenchLayout } from "./layout.js";
import { escapeHtml, renderNodeInspector, renderPage } from "./pages/index.js";
import { DashboardRouter } from "./router.js";
import { DashboardStore } from "./state/store.js";
import { SnapshotTransport } from "./transport/sse.js";

const groups: [string, [DashboardRoute, string, string][]][] = [
	[
		"Workspace",
		[
			["overview", "Overview", "⌂"],
			["workspace", "Workspace", "⌘"],
			["graph", "Graph", "◇"],
			["nodes", "Nodes", "□"],
		],
	],
	[
		"Operations",
		[
			["operations", "Operations", "↻"],
			["tasks", "Tasks", "▷"],
			["artifacts", "Artifacts", "▱"],
		],
	],
	[
		"Observe",
		[
			["events", "Events", "≋"],
			["logs", "Logs", "≣"],
			["diagnostics", "Diagnostics", "!"],
			["health", "Health", "♡"],
			["metrics", "Metrics", "⌁"],
			["timeline", "Timeline", "⟷"],
		],
	],
	[
		"System",
		[
			["plugins", "Plugins", "⌘"],
			["providers", "Providers", "⬡"],
			["configuration", "Configuration", "⚙"],
			["settings", "Settings", "☷"],
		],
	],
];
type Theme = "light" | "dark" | "system";
const setting = (key: string, fallback: string) => {
	try {
		return localStorage.getItem(`wsrt.${key}`) ?? fallback;
	} catch {
		return fallback;
	}
};
const save = (key: string, value: string) => {
	try {
		localStorage.setItem(`wsrt.${key}`, value);
	} catch {}
};

export function mountDashboard(root: HTMLElement) {
	const store = new DashboardStore();
	let route: DashboardRoute = "overview",
		scale = 1,
		panX = 0,
		panY = 0,
		palette = false,
		drawer = false;
	let theme = setting("theme", "system") as Theme,
		collapsed = setting("sidebar", "expanded") === "collapsed";
	const base =
		document.querySelector<HTMLMetaElement>('meta[name="wsrt-base-path"]')?.content ?? "";
	const mutable =
		document.querySelector<HTMLMetaElement>('meta[name="wsrt-mutations"]')?.content === "true";
	const applyTheme = () => {
		document.documentElement.dataset.theme = theme;
		document.documentElement.classList.toggle(
			"dark",
			theme === "dark" ||
				(theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches),
		);
	};
	const layout = new WorkbenchLayout(() => render());
	applyTheme();
	const render = () => {
		const snapshot = store.state.snapshot?.controlPlane;
		const active =
			snapshot?.operations.filter((o) => o.status === "running" || o.status === "pending").length ??
			0;
		const unhealthy =
			snapshot?.nodes.filter((n) => n.health === "unhealthy" || n.health === "degraded").length ??
			0;
		const extensionLinks = store.state.contributions
			.filter((item) => item.kind === "page")
			.map(
				(item) =>
					`<a href="${base}/ext:${encodeURIComponent(item.id)}" data-route="ext:${escapeHtml(item.id)}" ${route === `ext:${item.id}` ? 'aria-current="page"' : ""}><span class="nav-icon">＋</span><span class="nav-label">${escapeHtml(item.title ?? item.id)}</span></a>`,
			)
			.join("");
		const pageTitle = route.startsWith("ext:")
			? store.state.contributions.find((item) => item.id === route.slice(4))?.title
			: groups.flatMap((g) => g[1]).find(([id]) => id === route)?.[1];
		root.innerHTML = `<div class="app-shell ${collapsed ? "sidebar-collapsed" : ""} ${drawer ? "drawer-open" : ""} ${store.state.selectedNode ? "inspector-open" : ""}"><a class="skip-link" href="#main">Skip to content</a><div class="scrim" data-action="close-drawer"></div><aside class="sidebar" aria-label="Primary navigation"><div class="brand"><span class="brand-mark">W</span><span class="brand-copy"><b>WSRT</b><small>Runtime workbench</small></span><button class="icon-button collapse" data-action="collapse" aria-label="${collapsed ? "Expand" : "Collapse"} sidebar">‹</button></div><nav>${groups.map(([label, items]) => `<section><h2>${label}</h2>${items.map(([id, text, icon]) => `<a href="${base}/${id === "overview" ? "" : id}" data-route="${id}" ${route === id ? 'aria-current="page"' : ""} title="${text}"><span class="nav-icon">${icon}</span><span class="nav-label">${text}</span></a>`).join("")}</section>`).join("")}${extensionLinks ? `<section><h2>Extensions</h2>${extensionLinks}</section>` : ""}</nav><div class="sidebar-foot"><span class="connection ${store.state.connected ? "online" : "offline"}"><i></i><span>${store.state.connected ? `Live · revision ${snapshot?.revision ?? "—"}` : "Reconnecting…"}</span></span></div></aside><div class="workspace"><header class="topbar"><button class="icon-button menu" data-action="open-drawer" aria-label="Open navigation">☰</button><div class="title"><span class="breadcrumb">${escapeHtml(snapshot?.workspace.name ?? "Workspace")} /</span><b>${escapeHtml(pageTitle ?? "Overview")}</b></div><button class="command-trigger" data-action="palette"><span>Search workspace or run a command</span><kbd>⌘ K</kbd></button><div class="top-status"><span class="status-pill ${unhealthy ? "warning" : "success"}">${unhealthy ? `${unhealthy} attention` : "Healthy"}</span>${active ? `<span class="status-pill info">${active} active</span>` : ""}<button class="icon-button" data-action="theme" aria-label="Theme: ${theme}" title="Theme: ${theme}">${theme === "light" ? "☀" : theme === "dark" ? "☾" : "◐"}</button></div></header><div class="editor-area"><main id="main" tabindex="-1">${!store.state.connected && snapshot ? `<div class="connection-banner" role="status">Connection lost. Showing snapshot revision ${snapshot.revision}; reconnecting automatically.</div>` : ""}${!mutable ? `<div class="readonly-note">Read-only mode — lifecycle controls are unavailable.</div>` : ""}${renderPage(route, store.state)}</main>${renderNodeInspector(store.state)}</div><footer class="statusbar"><span class="${store.state.connected ? "success" : "danger"}">● ${store.state.connected ? "Connected" : "Offline"}</span><span>${snapshot?.nodes.filter((node) => node.state === "running").length ?? 0}/${snapshot?.nodes.length ?? 0} running</span><span>${active} operations</span><span>${snapshot?.diagnostics.length ?? 0} diagnostics</span><span class="status-spacer"></span><span>${store.state.selectedNode ? `Node: ${escapeHtml(store.state.selectedNode)}` : escapeHtml(snapshot?.workspace.name ?? "No workspace")}</span></footer></div>${palette ? renderPalette(snapshot, store.state.contributions) : ""}<div class="toasts" aria-live="polite" aria-atomic="false"></div><dialog id="confirm-dialog"><form method="dialog"><span class="eyebrow">Confirm operation</span><h2 id="confirm-title">Continue?</h2><p id="confirm-detail"></p><div class="dialog-actions"><button value="cancel">Cancel</button><button value="confirm" class="danger-button">Confirm</button></div></form></dialog></div>`;
		if (!mutable)
			for (const button of root.querySelectorAll<HTMLButtonElement>("[data-mutate]")) {
				button.disabled = true;
				button.title = "Mutations are disabled for this dashboard";
			}
		layout.enhance(root, store.state);
		applyContributionSurfaces(root, store.state, route);
		const virtual = root.querySelector<HTMLElement>(".virtual-list");
		if (virtual && store.state.virtualStart > 0)
			virtual.scrollTop = store.state.virtualStart * Number(virtual.dataset.rowHeight ?? 30);
		const graphViewport = root.querySelector<SVGGElement>("#graph-viewport");
		if (graphViewport)
			graphViewport.style.transform = `translate(${panX}px,${panY}px) scale(${scale})`;
	};
	const router = new DashboardRouter((next) => {
		route = next;
		drawer = false;
		render();
	});
	const toast = (message: string, kind = "success") => {
		const region = root.querySelector(".toasts");
		if (!region) return;
		const item = document.createElement("div");
		item.className = `toast ${kind}`;
		item.textContent = message;
		region.append(item);
		setTimeout(() => item.remove(), 4000);
	};
	const navigate = (value?: string) => {
		if (value) {
			palette = false;
			router.navigate(value as DashboardRoute);
		}
	};
	root.addEventListener("click", async (event) => {
		const target = event.target as HTMLElement,
			link = target.closest<HTMLElement>("[data-route]");
		if (link) {
			event.preventDefault();
			navigate(link.dataset.route);
			return;
		}
		const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
		if (action === "palette") {
			palette = !palette;
			render();
			setTimeout(() => root.querySelector<HTMLInputElement>("#palette-search")?.focus());
		}
		if (action === "collapse") {
			layout.toggleSidebar();
			collapsed = layout.state.sidebarCollapsed;
			save("sidebar", collapsed ? "collapsed" : "expanded");
		}
		if (action === "open-drawer") {
			drawer = true;
			render();
		}
		if (action === "close-drawer") {
			drawer = false;
			render();
		}
		if (action === "theme") {
			theme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
			save("theme", theme);
			applyTheme();
			render();
		}
		if (action === "refresh")
			void transport.refresh().catch((e) => store.dispatch({ type: "error", value: String(e) }));
		if (action === "clear-selection") store.dispatch({ type: "select-node", id: undefined });
		if (action === "toggle-events")
			store.dispatch({
				type: "pause-events",
				value: !store.state.eventsPaused,
			});
		if (action === "clear-events") store.dispatch({ type: "clear-visible-events" });
		if (action === "line-wrap") store.dispatch({ type: "line-wrap", value: !store.state.lineWrap });
		if (action === "jump-newest") {
			store.dispatch({ type: "virtual-window", value: 0 });
			root.querySelector<HTMLElement>(".virtual-list")?.scrollTo({ top: 0 });
		}
		if (action === "clear-graph-filters") {
			store.dispatch({ type: "search", value: "" });
			for (const field of ["kind", "health", "state"] as const)
				store.dispatch({ type: "graph-filter", field, value: "" });
		}
		if (action === "layout-reset") layout.reset();
		if (action === "toggle-bottom") layout.toggleBottom();
		const bottomTab = target.closest<HTMLElement>("[data-open-bottom]")?.dataset.openBottom;
		if (bottomTab)
			layout.open(
				bottomTab as "logs" | "events" | "timeline" | "operations" | "diagnostics",
				store.state.selectedNode,
			);
		const node = target.closest<HTMLElement>("[data-node]");
		if (node) store.dispatch({ type: "select-node", id: node.dataset.node });
		const graph = target.closest<HTMLElement>("[data-graph]")?.dataset.graph;
		if (graph) {
			scale =
				graph === "fit" || graph === "reset"
					? 1
					: Math.min(2.5, Math.max(0.4, scale + (graph === "in" ? 0.15 : -0.15)));
			if (graph === "fit" || graph === "reset") {
				panX = 0;
				panY = 0;
			}
			const viewport = root.querySelector<SVGGElement>("#graph-viewport");
			if (viewport) viewport.style.transform = `translate(${panX}px,${panY}px) scale(${scale})`;
		}
		const copy = target.closest<HTMLElement>("[data-copy]")?.dataset.copy;
		if (copy) void navigator.clipboard?.writeText(copy).then(() => toast("Copied to clipboard"));
		const mutation = target.closest<HTMLButtonElement>("[data-mutate]");
		if (mutation) {
			if (!mutable) return toast("Dashboard is read-only", "warning");
			const operation = mutation.dataset.mutate,
				id = mutation.dataset.id;
			if (!operation || !id) return;
			if (["stop", "restart"].includes(operation) && !(await confirmOperation(root, operation, id)))
				return;
			mutation.disabled = true;
			mutation.textContent = "Starting…";
			try {
				const resource = operation === "run" ? "tasks" : "nodes";
				const response = await fetch(
					`${base}/api/${resource}/${encodeURIComponent(id)}/${operation}`,
					{ method: "POST" },
				);
				const body = await response.json();
				if (!response.ok) throw new Error(body.error?.message ?? `HTTP ${response.status}`);
				toast(
					`${operation === "run" ? "Task" : "Operation"} started${body.operationId ? ` · ${body.operationId}` : ""}`,
				);
			} catch (cause) {
				toast(cause instanceof Error ? cause.message : String(cause), "danger");
			} finally {
				mutation.disabled = false;
			}
		}
		const contributed = target.closest<HTMLButtonElement>("[data-contribution]");
		if (contributed?.dataset.contribution) {
			if (!mutable) return toast("Dashboard is read-only", "warning");
			try {
				const response = await fetch(
					`${base}/api/contributions/${encodeURIComponent(contributed.dataset.contribution)}/run`,
					{ method: "POST" },
				);
				const body = await response.json();
				if (!response.ok) throw new Error(body.error?.message ?? `HTTP ${response.status}`);
				palette = false;
				toast("Plugin action completed");
				render();
			} catch (cause) {
				toast(cause instanceof Error ? cause.message : String(cause), "danger");
			}
		}
		const cancellation = target.closest<HTMLButtonElement>("[data-cancel-operation]");
		if (cancellation?.dataset.cancelOperation) {
			if (!mutable) return toast("Dashboard is read-only", "warning");
			cancellation.disabled = true;
			try {
				const response = await fetch(
					`${base}/api/operations/${encodeURIComponent(cancellation.dataset.cancelOperation)}/cancel`,
					{ method: "POST" },
				);
				const body = await response.json();
				if (!response.ok) throw new Error(body.error?.message ?? `HTTP ${response.status}`);
				toast("Cancellation requested");
			} catch (cause) {
				toast(cause instanceof Error ? cause.message : String(cause), "danger");
			}
		}
	});
	root.addEventListener("input", (event) => {
		const target = event.target as HTMLInputElement;
		if (target.id === "event-filter")
			store.dispatch({ type: "filter-events", value: target.value });
		if (target.dataset.filter === "global") store.dispatch({ type: "search", value: target.value });
		if (target.dataset.graphFilter)
			store.dispatch({
				type: "graph-filter",
				field: target.dataset.graphFilter as "kind" | "health" | "state",
				value: target.value,
			});
		if (target.id === "palette-search") filterPalette(root, target.value);
	});
	let scrollFrame = 0;
	root.addEventListener(
		"scroll",
		(event) => {
			const target = event.target as HTMLElement;
			if (!target.matches(".virtual-list") || scrollFrame) return;
			scrollFrame = requestAnimationFrame(() => {
				scrollFrame = 0;
				const height = Number(target.dataset.rowHeight ?? 30);
				store.dispatch({
					type: "virtual-window",
					value: Math.max(0, Math.floor(target.scrollTop / height) - 10),
				});
			});
		},
		true,
	);
	root.addEventListener("keydown", (event) => {
		const target = event.target as HTMLElement;
		if ((event.key === "Enter" || event.key === " ") && target.matches(".graph-node[data-node]")) {
			event.preventDefault();
			store.dispatch({ type: "select-node", id: target.dataset.node });
		}
		if (event.key.startsWith("Arrow") && target.matches(".graph-node[data-node]")) {
			event.preventDefault();
			const nodes = [...root.querySelectorAll<HTMLElement>(".graph-node[data-node]")];
			const index = nodes.indexOf(target);
			const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
			const next = nodes[(index + step + nodes.length) % nodes.length];
			next?.focus();
			if (next?.dataset.node) store.dispatch({ type: "select-node", id: next.dataset.node });
		}
	});
	root.addEventListener("pointerdown", (event) => {
		const graph = (event.target as HTMLElement).closest<HTMLElement>(".graph");
		if (!graph || (event.target as HTMLElement).closest(".graph-node")) return;
		const startX = event.clientX;
		const startY = event.clientY;
		const initialX = panX;
		const initialY = panY;
		graph.setPointerCapture(event.pointerId);
		const move = (next: PointerEvent) => {
			panX = initialX + next.clientX - startX;
			panY = initialY + next.clientY - startY;
			const viewport = root.querySelector<SVGGElement>("#graph-viewport");
			if (viewport) viewport.style.transform = `translate(${panX}px,${panY}px) scale(${scale})`;
		};
		graph.addEventListener("pointermove", move);
		graph.addEventListener("pointerup", () => graph.removeEventListener("pointermove", move), {
			once: true,
		});
	});
	root.addEventListener(
		"wheel",
		(event) => {
			if (!(event.target as HTMLElement).closest(".graph")) return;
			event.preventDefault();
			scale = Math.min(2.5, Math.max(0.4, scale + (event.deltaY < 0 ? 0.08 : -0.08)));
			const viewport = root.querySelector<SVGGElement>("#graph-viewport");
			if (viewport) viewport.style.transform = `translate(${panX}px,${panY}px) scale(${scale})`;
		},
		{ passive: false },
	);
	document.addEventListener("keydown", (event) => {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
			event.preventDefault();
			palette = true;
			render();
			setTimeout(() => root.querySelector<HTMLInputElement>("#palette-search")?.focus());
		}
		if (event.key === "Escape" && palette) {
			palette = false;
			render();
		}
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
			event.preventDefault();
			layout.toggleBottom();
		}
	});
	const unsubscribe = store.subscribe(() => render()),
		stopRouter = router.start(),
		transport = new SnapshotTransport(
			(snapshot) => store.dispatch({ type: "snapshot", snapshot }),
			(value) => store.dispatch({ type: "connected", value }),
			{
				onProtocolError: (message) =>
					store.dispatch({
						type: "error",
						value: `${message}. Adjust dashboard frame limits or reduce the workspace projection.`,
					}),
			},
		);
	void transport.start();
	void fetch(`${base}/api/contributions`)
		.then((response) => response.json())
		.then((value) =>
			store.dispatch({
				type: "contributions",
				value: Array.isArray(value) ? value : [],
			}),
		)
		.catch(() => {});
	return () => {
		transport.close();
		layout.dispose();
		stopRouter();
		unsubscribe();
	};
}

function renderPalette(
	snapshot?: {
		nodes: readonly { id: string }[];
		operations?: readonly { id: string; type: string }[];
		artifacts?: readonly { id: string }[];
		plugins?: readonly { id: string }[];
	},
	contributions: readonly { id: string; kind: string; title?: string }[] = [],
) {
	const commands = groups
		.flatMap((g) => g[1])
		.map(
			([route, label, icon]) =>
				`<button data-route="${route}" data-search="${label.toLowerCase()}"><span>${icon}</span><b>${label}</b><small>Navigate</small></button>`,
		)
		.join("");
	const nodes = (snapshot?.nodes ?? [])
		.slice(0, 30)
		.map(
			(n) =>
				`<button data-route="nodes" data-search="${escapeHtml(n.id.toLowerCase())}"><span>□</span><b>${escapeHtml(n.id)}</b><small>Node</small></button>`,
		)
		.join("");
	const entities = [
		...(snapshot?.operations ?? [])
			.slice(-20)
			.map((item) => [item.id, `Operation · ${item.type}`, "operations"]),
		...(snapshot?.artifacts ?? []).map((item) => [item.id, "Artifact", "artifacts"]),
		...(snapshot?.plugins ?? []).map((item) => [item.id, "Plugin", "plugins"]),
		...contributions
			.filter((item) => item.kind === "page")
			.map((item) => [item.title ?? item.id, "Plugin page", `ext:${item.id}`]),
	]
		.map(
			([label, kind, target]) =>
				`<button data-route="${escapeHtml(target)}" data-search="${escapeHtml(`${label} ${kind}`.toLowerCase())}"><span>⌁</span><b>${escapeHtml(label)}</b><small>${escapeHtml(kind)}</small></button>`,
		)
		.join("");
	const actions = contributions
		.filter((item) =>
			["action", "command", "artifact-action", "operation-action"].includes(item.kind),
		)
		.map(
			(item) =>
				`<button data-contribution="${escapeHtml(item.id)}" data-search="${escapeHtml(`${item.title ?? item.id} action`.toLowerCase())}"><span>▷</span><b>${escapeHtml(item.title ?? item.id)}</b><small>Plugin action</small></button>`,
		)
		.join("");
	return `<div class="modal-backdrop" data-action="palette"><section class="command-menu" role="dialog" aria-modal="true" aria-label="Command palette"><label><span class="sr-only">Search commands</span><input id="palette-search" autocomplete="off" placeholder="Search nodes, plugins, operations, artifacts…"></label><div class="command-results"><h2>Workspace</h2>${commands}${nodes}${entities}${actions}</div><footer><kbd>↑↓</kbd> move <kbd>Enter</kbd> open <kbd>Esc</kbd> close</footer></section></div>`;
}
function filterPalette(root: HTMLElement, value: string) {
	for (const item of root.querySelectorAll<HTMLElement>("[data-search]"))
		item.hidden = !item.dataset.search?.includes(value.toLowerCase());
}
async function confirmOperation(root: HTMLElement, operation: string, id: string) {
	const dialog = root.querySelector<HTMLDialogElement>("#confirm-dialog"),
		title = dialog?.querySelector("#confirm-title"),
		detail = dialog?.querySelector("#confirm-detail");
	if (!dialog || !title || !detail) return false;
	title.textContent = `${operation[0].toUpperCase()}${operation.slice(1)} ${id}?`;
	detail.textContent =
		operation === "stop"
			? "This may interrupt dependent work."
			: "The node will be stopped and started again.";
	dialog.showModal();
	return new Promise<boolean>((resolve) =>
		dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), {
			once: true,
		}),
	);
}

if (typeof document !== "undefined") {
	const root = document.querySelector<HTMLElement>("#app");
	if (root) mountDashboard(root);
}
