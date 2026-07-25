import type { DashboardState } from "./state/store.js";

export type BottomPanelTab = "logs" | "events" | "timeline" | "operations" | "diagnostics";
export type WorkbenchLayoutState = Readonly<{
	version: 1;
	sidebarWidth: number;
	inspectorWidth: number;
	bottomHeight: number;
	sidebarCollapsed: boolean;
	inspectorCollapsed: boolean;
	bottomCollapsed: boolean;
	bottomMaximized: boolean;
	bottomTab: BottomPanelTab;
}>;

const defaults: WorkbenchLayoutState = Object.freeze({
	version: 1,
	sidebarWidth: 242,
	inspectorWidth: 360,
	bottomHeight: 220,
	sidebarCollapsed: false,
	inspectorCollapsed: false,
	bottomCollapsed: true,
	bottomMaximized: false,
	bottomTab: "logs",
});
const tabs: readonly BottomPanelTab[] = ["logs", "events", "timeline", "operations", "diagnostics"];

export class WorkbenchLayout {
	#state = loadLayout();
	#root?: HTMLElement;
	#previousFocus?: HTMLElement;
	readonly #onChange: () => void;
	constructor(onChange: () => void) {
		this.#onChange = onChange;
	}
	get state() {
		return this.#state;
	}
	enhance(root: HTMLElement, dashboard: DashboardState) {
		this.#root = root;
		const shell = root.querySelector<HTMLElement>(".app-shell");
		const sidebar = root.querySelector<HTMLElement>(".sidebar");
		const inspector = root.querySelector<HTMLElement>(".inspector");
		const workspace = root.querySelector<HTMLElement>(".workspace");
		const statusbar = root.querySelector<HTMLElement>(".statusbar");
		if (!shell || !sidebar || !workspace || !statusbar) return;
		shell.style.setProperty(
			"--sidebar",
			`${this.#state.sidebarCollapsed ? 68 : this.#state.sidebarWidth}px`,
		);
		shell.style.setProperty("--inspector", `${this.#state.inspectorWidth}px`);
		shell.style.setProperty(
			"--bottom-panel",
			`${this.#state.bottomMaximized ? Math.max(320, innerHeight - 150) : this.#state.bottomHeight}px`,
		);
		shell.classList.toggle("sidebar-collapsed", this.#state.sidebarCollapsed);
		shell.classList.toggle(
			"inspector-collapsed",
			this.#state.inspectorCollapsed || !dashboard.selectedNode,
		);
		shell.classList.toggle("bottom-open", !this.#state.bottomCollapsed);
		sidebar.after(this.#handle("sidebar", "Resize explorer", "vertical", this.#state.sidebarWidth));
		if (inspector)
			inspector.before(
				this.#handle("inspector", "Resize inspector", "vertical", this.#state.inspectorWidth),
			);
		if (!this.#state.bottomCollapsed) statusbar.before(this.#bottomPanel(dashboard));
	}
	open(tab: BottomPanelTab, node?: string) {
		this.#previousFocus = document.activeElement as HTMLElement;
		this.#update({ bottomCollapsed: false, bottomTab: tab });
		if (node && this.#root) {
			const input = this.#root.querySelector<HTMLInputElement>("#bottom-filter");
			if (input) {
				input.value = node;
				input.dispatchEvent(new Event("input"));
			}
		}
		this.#root?.querySelector<HTMLElement>(".bottom-content")?.focus();
	}
	toggleBottom() {
		const closing = !this.#state.bottomCollapsed;
		if (!closing) this.#previousFocus = document.activeElement as HTMLElement;
		this.#update({ bottomCollapsed: closing });
		if (closing) this.#previousFocus?.focus();
		else this.#root?.querySelector<HTMLElement>(".bottom-content")?.focus();
	}
	toggleInspector() {
		this.#update({ inspectorCollapsed: !this.#state.inspectorCollapsed });
	}
	toggleSidebar() {
		this.#update({ sidebarCollapsed: !this.#state.sidebarCollapsed });
	}
	reset() {
		this.#state = defaults;
		saveLayout(this.#state);
		this.#onChange();
	}
	dispose() {
		this.#root = undefined;
	}
	#update(patch: Partial<WorkbenchLayoutState>, rerender = true) {
		this.#state = Object.freeze({ ...this.#state, ...patch });
		saveLayout(this.#state);
		if (rerender) this.#onChange();
	}
	#handle(kind: "sidebar" | "inspector", label: string, orientation: "vertical", value: number) {
		const handle = document.createElement("button");
		handle.className = `panel-resizer ${kind}-resizer`;
		handle.type = "button";
		handle.dataset.panelResize = kind;
		handle.setAttribute("aria-label", label);
		handle.setAttribute("aria-orientation", orientation);
		handle.setAttribute("aria-valuemin", kind === "sidebar" ? "180" : "280");
		handle.setAttribute("aria-valuemax", kind === "sidebar" ? "420" : "620");
		handle.setAttribute("aria-valuenow", String(value));
		handle.title = `${label}. Arrow keys resize; Home resets.`;
		this.#bindResize(handle, kind);
		return handle;
	}
	#bindResize(handle: HTMLButtonElement, kind: "sidebar" | "inspector" | "bottom") {
		const min = kind === "sidebar" ? 180 : kind === "inspector" ? 280 : 120;
		const max = kind === "sidebar" ? 420 : kind === "inspector" ? 620 : 520;
		const key =
			kind === "sidebar"
				? "sidebarWidth"
				: kind === "inspector"
					? "inspectorWidth"
					: "bottomHeight";
		const defaultValue = defaults[key];
		const set = (value: number, rerender = false) => {
			const next = Math.min(max, Math.max(min, Math.round(value)));
			this.#update({ [key]: next }, rerender);
			handle.setAttribute("aria-valuenow", String(next));
			const shell = this.#root?.querySelector<HTMLElement>(".app-shell");
			shell?.style.setProperty(
				kind === "sidebar" ? "--sidebar" : kind === "inspector" ? "--inspector" : "--bottom-panel",
				`${next}px`,
			);
		};
		handle.addEventListener("keydown", (event) => {
			const direction =
				event.key === "ArrowRight" || event.key === "ArrowUp"
					? 1
					: event.key === "ArrowLeft" || event.key === "ArrowDown"
						? -1
						: 0;
			if (event.key === "Home") {
				event.preventDefault();
				set(defaultValue, true);
			} else if (direction) {
				event.preventDefault();
				const invert = kind === "inspector" || kind === "bottom" ? -1 : 1;
				set(this.#state[key] + direction * invert * (event.shiftKey ? 32 : 8));
			}
		});
		handle.addEventListener("dblclick", () => set(defaultValue, true));
		handle.addEventListener("pointerdown", (event) => {
			if (matchMedia("(max-width: 760px)").matches) return;
			event.preventDefault();
			handle.setPointerCapture(event.pointerId);
			const start = kind === "bottom" ? event.clientY : event.clientX;
			const initial = this.#state[key];
			const move = (next: PointerEvent) => {
				const delta =
					(kind === "inspector" || kind === "bottom" ? -1 : 1) *
					((kind === "bottom" ? next.clientY : next.clientX) - start);
				set(initial + delta);
			};
			const end = () => {
				handle.removeEventListener("pointermove", move);
				saveLayout(this.#state);
			};
			handle.addEventListener("pointermove", move);
			handle.addEventListener("pointerup", end, { once: true });
		});
	}
	#bottomPanel(dashboard: DashboardState) {
		const panel = document.createElement("section");
		panel.className = "bottom-panel";
		panel.setAttribute("aria-label", "Runtime tools");
		const resize = document.createElement("button");
		resize.type = "button";
		resize.className = "panel-resizer bottom-resizer";
		resize.setAttribute("aria-label", "Resize bottom panel");
		resize.setAttribute("aria-orientation", "horizontal");
		resize.setAttribute("aria-valuemin", "120");
		resize.setAttribute("aria-valuemax", "520");
		resize.setAttribute("aria-valuenow", String(this.#state.bottomHeight));
		this.#bindResize(resize, "bottom");
		panel.append(resize);
		const header = document.createElement("header");
		header.innerHTML = `<div role="tablist" aria-label="Runtime tools">${tabs
			.map(
				(tab) =>
					`<button role="tab" aria-selected="${tab === this.#state.bottomTab}" data-bottom-tab="${tab}">${tab[0].toUpperCase()}${tab.slice(1)}</button>`,
			)
			.join(
				"",
			)}</div><span class="bottom-spacer"></span><button data-bottom-maximize aria-label="${this.#state.bottomMaximized ? "Restore" : "Maximize"} bottom panel">${this.#state.bottomMaximized ? "↙" : "↗"}</button><button data-bottom-close aria-label="Close bottom panel">×</button>`;
		panel.append(header);
		const content = document.createElement("div");
		content.className = "bottom-content";
		content.setAttribute("role", "tabpanel");
		content.tabIndex = 0;
		content.innerHTML = this.#panelContent(dashboard);
		panel.append(content);
		const filter = content.querySelector<HTMLInputElement>("#bottom-filter");
		filter?.addEventListener("input", () => {
			const query = filter.value.toLowerCase();
			for (const row of content.querySelectorAll<HTMLElement>(".bottom-rows>[role=listitem]"))
				row.hidden = !!query && !row.textContent?.toLowerCase().includes(query);
		});
		header.addEventListener("click", (event) => {
			const target = event.target as HTMLElement;
			const tab = target.closest<HTMLElement>("[data-bottom-tab]")?.dataset
				.bottomTab as BottomPanelTab;
			if (tab) this.#update({ bottomTab: tab });
			if (target.closest("[data-bottom-close]")) this.toggleBottom();
			if (target.closest("[data-bottom-maximize]"))
				this.#update({ bottomMaximized: !this.#state.bottomMaximized });
		});
		return panel;
	}
	#panelContent(dashboard: DashboardState) {
		const snapshot = dashboard.snapshot?.controlPlane;
		if (!snapshot) return `<p class="bottom-empty">Waiting for runtime snapshot…</p>`;
		const tab = this.#state.bottomTab;
		if (tab === "operations")
			return rows(snapshot.operations.slice(-100).reverse(), (item) => [
				item.status,
				item.type,
				item.id,
			]);
		if (tab === "diagnostics")
			return rows(snapshot.diagnostics, (item) => [item.severity, item.code, item.message]);
		const events = (dashboard.visibleEvents ?? dashboard.snapshot?.events ?? [])
			.slice(-500)
			.reverse();
		if (tab === "timeline" || tab === "events")
			return rows(events, (item) => [
				new Date(item.timestamp).toLocaleTimeString(),
				item.type,
				item.source,
			]);
		return `<label class="bottom-filter"><span class="sr-only">Filter bottom logs</span><input id="bottom-filter" placeholder="Filter logs by node or text"></label>${rows(
			events,
			(item) => [new Date(item.timestamp).toLocaleTimeString(), item.source, item.type],
		)}`;
	}
}

function rows<T>(values: readonly T[], project: (value: T) => readonly unknown[]) {
	if (!values.length) return `<p class="bottom-empty">No retained records.</p>`;
	return `<div class="bottom-rows" role="list">${values
		.map(
			(value, index) =>
				`<div role="listitem" tabindex="${index === 0 ? 0 : -1}">${project(value)
					.map((item) => `<span>${escapeText(item)}</span>`)
					.join("")}</div>`,
		)
		.join("")}</div>`;
}
function escapeText(value: unknown) {
	return String(value ?? "").replace(
		/[&<>"']/g,
		(character) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
			character,
	);
}
export function loadLayout(storage: Pick<Storage, "getItem"> = localStorage): WorkbenchLayoutState {
	try {
		const input = JSON.parse(storage.getItem("wsrt.layout.v1") ?? "null");
		if (input?.version !== 1) return defaults;
		return Object.freeze({
			...defaults,
			sidebarWidth: clamp(input.sidebarWidth, 180, 420, defaults.sidebarWidth),
			inspectorWidth: clamp(input.inspectorWidth, 280, 620, defaults.inspectorWidth),
			bottomHeight: clamp(input.bottomHeight, 120, 520, defaults.bottomHeight),
			sidebarCollapsed: !!input.sidebarCollapsed,
			inspectorCollapsed: !!input.inspectorCollapsed,
			bottomCollapsed: !!input.bottomCollapsed,
			bottomMaximized: !!input.bottomMaximized,
			bottomTab: tabs.includes(input.bottomTab) ? input.bottomTab : defaults.bottomTab,
		});
	} catch {
		return defaults;
	}
}
function saveLayout(value: WorkbenchLayoutState) {
	try {
		localStorage.setItem("wsrt.layout.v1", JSON.stringify(value));
	} catch {}
}
function clamp(value: unknown, min: number, max: number, fallback: number) {
	return typeof value === "number" && Number.isFinite(value)
		? Math.min(max, Math.max(min, value))
		: fallback;
}
