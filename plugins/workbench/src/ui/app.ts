import { AppShell } from "./components/app-shell/app-shell.js";
import { CommandPalette } from "./components/command-palette/command-palette.js";
import { EmptyState } from "./components/empty-state/empty-state.js";
import { ErrorState } from "./components/error-state/error-state.js";
import { Inspector } from "./components/inspector/inspector.js";
import { LoadingState } from "./components/loading-state/loading-state.js";
import { Navigation } from "./components/navigation/navigation.js";
import { StatusBadge } from "./components/status-badge/status-badge.js";
import { TopBar } from "./components/top-bar/top-bar.js";
import { element, replaceChildren } from "./core/dom.js";
import type { InspectTarget } from "./core/events.js";
import type { RouteTarget } from "./core/route.js";
import { WorkbenchRouter, WorkbenchRouterElement } from "./core/router.js";
import { WorkspaceSubscriptions } from "./core/subscriptions.js";
import { WorkspaceClient } from "./core/workspace-client.js";
import { renderFeature } from "./features/loader.js";
import { layoutState, persistLayout } from "./state/layout-state.js";
import { navigationState } from "./state/navigation-state.js";
import { runtimeState } from "./state/runtime-state.js";
import { description, workspaceState } from "./state/workspace-state.js";

export class WorkbenchApp extends HTMLElement {
	#client?: WorkspaceClient;
	#router?: WorkbenchRouter;
	#subscriptions?: WorkspaceSubscriptions;
	#mutable = true;
	#bound = false;
	#abort = new AbortController();
	#bootstrapRequest?: AbortController;
	#bootstrapSequence = 0;
	#renderSequence = 0;

	static define() {
		AppShell.define();
		Navigation.define();
		TopBar.define();
		CommandPalette.define();
		Inspector.define();
		StatusBadge.define();
		LoadingState.define();
		EmptyState.define();
		ErrorState.define();
		WorkbenchRouterElement.define();
		if (!customElements.get("wsrt-workbench-app"))
			customElements.define("wsrt-workbench-app", WorkbenchApp);
	}

	connectedCallback() {
		const basePath =
			document.querySelector<HTMLMetaElement>('meta[name="wsrt-base-path"]')?.content ?? "";
		this.#mutable =
			document.querySelector<HTMLMetaElement>('meta[name="wsrt-mutations"]')?.content === "true";
		this.#client = new WorkspaceClient({ basePath });
		this.#router = new WorkbenchRouter(basePath, (route) => {
			navigationState.update((state) => ({ ...state, route }));
			void this.render();
		});
		this.#router.start();
		this.#subscriptions = new WorkspaceSubscriptions(
			this.#client,
			(event) => {
				if (event.type === "snapshot.updated" || event.type === "workspace.revision.changed") {
					workspaceState.update((state) => ({ ...state, stale: true }));
					void this.bootstrap();
				}
			},
			(connected) => {
				workspaceState.update((state) => ({ ...state, connected }));
				void this.render();
			},
		);
		this.#subscriptions.start();
		if (!this.#bound) this.bindEvents();
		void this.bootstrap();
	}

	disconnectedCallback() {
		this.#router?.stop();
		this.#subscriptions?.close();
		this.#bootstrapRequest?.abort();
		this.#abort.abort();
		this.#abort = new AbortController();
		this.#bound = false;
	}

	private bindEvents() {
		this.#bound = true;
		this.addEventListener(
			"wsrt:navigate",
			(event) => {
				layoutState.update((state) => ({ ...state, drawerOpen: false }));
				this.#router?.navigate((event as CustomEvent<RouteTarget>).detail);
			},
			{ signal: this.#abort.signal },
		);
		this.addEventListener(
			"wsrt:inspect",
			(event) => {
				layoutState.update((state) => ({
					...state,
					inspector: (event as CustomEvent<InspectTarget>).detail,
				}));
				void this.render();
			},
			{ signal: this.#abort.signal },
		);
		this.addEventListener(
			"wsrt:close-inspector",
			() => {
				layoutState.update((state) => ({ ...state, inspector: undefined }));
				void this.render();
			},
			{ signal: this.#abort.signal },
		);
		this.addEventListener("wsrt:retry", () => void this.bootstrap(), {
			signal: this.#abort.signal,
		});
		this.addEventListener(
			"wsrt:command",
			(event) => {
				const command = (event as CustomEvent<{ command: string }>).detail.command;
				this.handleCommand(command);
			},
			{ signal: this.#abort.signal },
		);
		document.addEventListener(
			"keydown",
			(event) => {
				if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
					event.preventDefault();
					this.handleCommand("palette.toggle");
				}
				if (event.key === "Escape") this.handleCommand("escape");
			},
			{ signal: this.#abort.signal },
		);
	}

	private async bootstrap() {
		if (!this.#client) return;
		this.#bootstrapRequest?.abort();
		const request = new AbortController();
		const sequence = ++this.#bootstrapSequence;
		this.#bootstrapRequest = request;
		workspaceState.update((state) => ({ ...state, loading: true, error: undefined }));
		try {
			const data = await this.#client.bootstrap(request.signal);
			if (sequence !== this.#bootstrapSequence) return;
			workspaceState.set({ loading: false, connected: true, stale: false, data });
			const snapshot = description();
			runtimeState.set({
				lastRevision: snapshot?.workspaceRevision,
				activeOperations: data.operations.filter((operation) =>
					["pending", "running"].includes(operation.status),
				).length,
				healthAttention: (snapshot?.nodes ?? []).filter((node) =>
					["degraded", "unhealthy"].includes(node.health?.state ?? ""),
				).length,
			});
		} catch (cause) {
			if (request.signal.aborted) return;
			workspaceState.update((state) => ({
				...state,
				loading: false,
				connected: false,
				error: cause instanceof Error ? cause.message : String(cause),
			}));
		}
		await this.render();
	}

	private handleCommand(command: string) {
		if (command === "layout.toggleSidebar")
			layoutState.update((state) => {
				const navigationMode: "expanded" | "collapsed" =
					state.navigationMode === "collapsed" ? "expanded" : "collapsed";
				const next = {
					...state,
					navigationMode,
				};
				persistLayout(next);
				return next;
			});
		if (command === "layout.openDrawer")
			layoutState.update((state) => ({ ...state, drawerOpen: true }));
		if (command === "palette.open" || command === "palette.toggle")
			navigationState.update((state) => ({
				...state,
				commandPaletteOpen: command === "palette.open" ? true : !state.commandPaletteOpen,
			}));
		if (command === "palette.close")
			navigationState.update((state) => ({ ...state, commandPaletteOpen: false }));
		if (command === "theme.toggle")
			layoutState.update((state) => {
				const theme: "system" | "light" | "dark" =
					state.theme === "system" ? "light" : state.theme === "light" ? "dark" : "system";
				const next = { ...state, theme };
				persistLayout(next);
				return next;
			});
		if (command === "escape") {
			navigationState.update((state) => ({ ...state, commandPaletteOpen: false }));
			layoutState.update((state) => ({ ...state, inspector: undefined, drawerOpen: false }));
		}
		void this.render();
	}

	private async render() {
		const sequence = ++this.#renderSequence;
		this.applyTheme();
		const workspace = workspaceState.get();
		const navigation = navigationState.get();
		const layout = layoutState.get();
		const runtime = runtimeState.get();
		const shell = new AppShell();
		shell.navigationMode = layout.drawerOpen ? "drawer" : layout.navigationMode;
		shell.inspecting = !!layout.inspector;

		const nav = new Navigation();
		nav.slot = "navigation";
		nav.active = navigation.route.id;
		nav.mode = layout.drawerOpen ? "drawer" : layout.navigationMode;
		nav.connected = workspace.connected;
		nav.revision = runtime.lastRevision;

		const top = new TopBar();
		top.slot = "topbar";
		top.route = navigation.route.id;
		top.workspaceName = description()?.workspace?.name ?? "Workspace";
		top.healthAttention = runtime.healthAttention;

		const statusbar = element(
			"footer",
			{ slot: "statusbar", class: "statusbar" },
			element("span", {}, workspace.connected ? "Authoritative" : "Offline"),
			element("span", {}, `Revision ${description()?.workspaceRevision ?? "-"}`),
			element("span", {}, `${runtime.activeOperations} active operations`),
		);

		const palette = new CommandPalette();
		palette.slot = "palette";
		palette.open = navigation.commandPaletteOpen;
		palette.description = description();

		const inspector = new Inspector();
		inspector.slot = "inspector";
		inspector.client = this.#client;
		inspector.target = layout.inspector;

		const content = await this.mainContent();
		if (sequence !== this.#renderSequence) return;
		shell.append(nav, top, content, inspector, statusbar, palette);
		shell.shadowRoot?.querySelector(".mobile-scrim")?.addEventListener(
			"click",
			() => {
				layoutState.update((state) => ({ ...state, drawerOpen: false }));
				void this.render();
			},
			{ signal: this.#abort.signal },
		);
		replaceChildren(this, shell);
		if (layout.inspector) void inspector.load();
	}

	private async mainContent() {
		const workspace = workspaceState.get();
		if (workspace.loading) {
			const loading = new LoadingState();
			loading.message = "Loading authoritative workspace data...";
			return loading;
		}
		if (workspace.error) {
			const error = new ErrorState();
			error.message = workspace.error;
			return error;
		}
		const route = navigationState.get().route.id;
		try {
			if (workspace.stale)
				return element(
					"div",
					{},
					element(
						"div",
						{ class: "banner" },
						"Workspace revision changed. Refreshing authoritative results...",
					),
					await renderFeature(route, {
						description: description(),
						data: workspace.data,
						filter: navigationState.get().filter,
						mutable: this.#mutable,
					}),
				);
			return await renderFeature(route, {
				description: description(),
				data: workspace.data,
				filter: navigationState.get().filter,
				mutable: this.#mutable,
			});
		} catch (cause) {
			const error = new ErrorState();
			error.message = cause instanceof Error ? cause.message : String(cause);
			return error;
		}
	}

	private applyTheme() {
		const theme = layoutState.get().theme;
		const dark =
			theme === "dark" ||
			(theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
		document.documentElement.classList.toggle("dark", dark);
	}
}

declare global {
	interface HTMLElementEventMap {
		"wsrt:navigate": CustomEvent<RouteTarget>;
		"wsrt:inspect": CustomEvent<InspectTarget>;
	}
}
