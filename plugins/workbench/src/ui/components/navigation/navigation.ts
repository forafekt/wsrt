import { dispatch, element } from "../../core/dom.js";
import type { RouteId } from "../../core/route.js";
import type { NavigationMode } from "../../state/layout-state.js";
import { defineElement, WorkbenchElement } from "../base.js";

const groups: readonly [string, readonly RouteId[]][] = [
	["Workspace", ["overview", "architecture", "projects", "nodes", "files"]],
	["Intelligence", ["impact", "validation", "artifacts"]],
	["Runtime", ["runtime", "operations", "diagnostics", "sessions"]],
	["System", ["settings"]],
];

const labels = new Map<RouteId, string>([
	["overview", "Overview"],
	["architecture", "Architecture"],
	["projects", "Projects"],
	["nodes", "Nodes"],
	["files", "Files"],
	["impact", "Impact"],
	["validation", "Validation"],
	["runtime", "Runtime"],
	["operations", "Operations"],
	["diagnostics", "Diagnostics"],
	["artifacts", "Artifacts"],
	["sessions", "Sessions"],
	["settings", "Settings"],
	["not-found", "Not found"],
]);

export class Navigation extends WorkbenchElement {
	active: RouteId = "overview";
	mode: NavigationMode = "expanded";
	connected = false;
	revision?: number;
	static define() {
		defineElement("wsrt-workbench-navigation", Navigation);
	}
	protected update() {
		this.setAttribute("mode", this.mode);
		super.update();
	}
	protected render() {
		return element(
			"aside",
			{
				class: this.mode,
				aria: { label: this.mode === "drawer" ? "Navigation drawer" : "Primary navigation" },
			},
			element("style", {}, styles),
			this.brand(),
			element(
				"nav",
				{},
				...groups.map(([name, routes]) =>
					element(
						"section",
						{},
						element("h2", {}, name),
						...routes.map((route) => this.link(route)),
					),
				),
			),
			element(
				"div",
				{ class: `connection ${this.connected ? "online" : ""}` },
				element("i"),
				element("span", {}, this.connected ? `Connected r${this.revision ?? "-"}` : "Reconnecting"),
			),
		);
	}
	private brand() {
		const button = element(
			"button",
			{ type: "button", class: "icon", aria: { label: "Collapse navigation" } },
			this.mode === "collapsed" ? "›" : "‹",
		);
		button.addEventListener("click", () =>
			dispatch(this, "wsrt:command", { command: "layout.toggleSidebar" }),
		);
		return element(
			"div",
			{ class: "brand" },
			element("span", { class: "mark" }, "W"),
			element(
				"span",
				{ class: "copy" },
				element("b", {}, "WSRT"),
				element("small", {}, "Workbench"),
			),
			button,
		);
	}
	private link(route: RouteId) {
		const anchor = element(
			"a",
			{
				href: route === "overview" ? "." : route,
				title: labels.get(route) ?? route,
				aria:
					this.active === route
						? { current: "page", label: labels.get(route) ?? route }
						: { label: labels.get(route) ?? route },
			},
			element("span", { class: "symbol" }, symbol(route)),
			element("span", { class: "label" }, labels.get(route) ?? route),
		);
		anchor.addEventListener("click", (event) => {
			event.preventDefault();
			dispatch(this, "wsrt:navigate", { id: route });
		});
		return anchor;
	}
}

function symbol(route: RouteId) {
	return (
		{
			overview: "⌂",
			architecture: "◇",
			projects: "▦",
			nodes: "□",
			files: "≡",
			impact: "↗",
			validation: "✓",
			runtime: "▷",
			operations: "↻",
			diagnostics: "!",
			artifacts: "▱",
			sessions: "⌁",
			settings: "⚙",
			"not-found": "?",
		} as const
	)[route];
}

const styles = `
:host{display:block;block-size:100%;min-block-size:0;min-inline-size:0}
aside{position:relative;block-size:100%;min-block-size:0;background:#111827;color:#dbe2ee;min-width:0;display:flex;flex-direction:column;border-right:1px solid #ffffff12;z-index:5}
.brand{height:64px;display:flex;align-items:center;gap:11px;padding:0 15px;border-bottom:1px solid #ffffff12}
.mark{width:34px;height:34px;border-radius:8px;display:grid;place-items:center;background:#fff;color:#111827;font-size:15px;font-weight:800}
.copy{display:flex;flex-direction:column;white-space:nowrap}.copy small{color:#8491a5;font-size:10px;margin-top:2px}
.icon{margin-left:auto;border:0;background:transparent;color:inherit;border-radius:7px;width:32px;height:32px;cursor:pointer}.icon:hover{background:#ffffff14}
nav{padding:12px 9px;overflow:auto;flex:1}
section{margin:0 0 16px}
h2{font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#68768b;padding:0 10px;margin:0 0 5px}
a{display:flex;align-items:center;gap:10px;height:34px;padding:0 10px;border-radius:7px;color:#aeb8c8;text-decoration:none;white-space:nowrap;margin:2px 0}
a:hover{background:#ffffff0c;color:#fff}a[aria-current=page]{background:#334155;color:#fff}.symbol{width:17px;text-align:center;font-weight:700}
.connection{display:flex;align-items:center;gap:8px;padding:14px;color:#94a3b8;border-top:1px solid #ffffff12;white-space:nowrap}.connection i{width:7px;height:7px;border-radius:50%;background:var(--wsrt-color-danger)}.connection.online i{background:#45d49c;box-shadow:0 0 0 4px #45d49c18}
.collapsed .copy,.collapsed .label,.collapsed h2,.collapsed .connection span{display:none}.collapsed a{justify-content:center;padding:0}.collapsed .brand{flex-direction:column;justify-content:center;gap:2px;padding:4px 0}.collapsed .mark{width:28px;height:28px;border-radius:7px}.collapsed .icon{margin:0;width:22px;height:22px;border:1px solid #ffffff1f;background:#111827;font-size:12px}
@media(max-width:800px){:host{position:fixed;left:calc(-1 * var(--wsrt-navigation-width-expanded));top:0;bottom:0;width:var(--wsrt-navigation-width-expanded);z-index:5;transition:left var(--wsrt-layout-transition-duration) ease}:host([mode=drawer]){left:0}}
@media(prefers-reduced-motion:reduce){:host{transition:none}}
`;
