import { dispatch, element } from "../../core/dom.js";
import type { RouteId } from "../../core/route.js";
import { defineElement, WorkbenchElement } from "../base.js";

export class TopBar extends WorkbenchElement {
	route: RouteId = "overview";
	workspaceName = "Workspace";
	healthAttention = 0;
	static define() {
		defineElement("wsrt-workbench-topbar", TopBar);
	}
	protected render() {
		const menu = element(
			"button",
			{ type: "button", class: "icon menu", aria: { label: "Open navigation" } },
			"☰",
		);
		menu.addEventListener("click", () =>
			dispatch(this, "wsrt:command", { command: "layout.openDrawer" }),
		);
		const search = element(
			"button",
			{ type: "button", class: "search" },
			element("span", {}, "Search workspace or run a command"),
			element("kbd", {}, "Ctrl K"),
		);
		search.addEventListener("click", () =>
			dispatch(this, "wsrt:command", { command: "palette.open" }),
		);
		const theme = element(
			"button",
			{ type: "button", class: "icon", aria: { label: "Change theme" } },
			"◐",
		);
		theme.addEventListener("click", () =>
			dispatch(this, "wsrt:command", { command: "theme.toggle" }),
		);
		return element(
			"header",
			{},
			element("style", {}, styles),
			menu,
			element(
				"div",
				{ class: "crumbs" },
				element("small", {}, `${this.workspaceName} / ${this.route}`),
				element("b", {}, title(this.route)),
			),
			search,
			element(
				"div",
				{ class: "actions" },
				element(
					"span",
					{ class: this.healthAttention ? "pill warn" : "pill good" },
					this.healthAttention ? `${this.healthAttention} need attention` : "Healthy",
				),
				theme,
			),
		);
	}
}

function title(value: string) {
	return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

const styles = `
:host{display:contents}
header{background:var(--wsrt-color-surface);border-bottom:1px solid var(--wsrt-color-border);display:flex;align-items:center;padding:0 17px;gap:16px}
.menu{display:none}.icon{border:0;background:transparent;color:inherit;border-radius:7px;width:32px;height:32px;cursor:pointer}.icon:hover{background:var(--wsrt-color-surface-subtle)}
.crumbs{min-width:180px;display:flex;flex-direction:column}.crumbs small{color:var(--wsrt-color-text-muted);font-size:10px}.crumbs b{font-size:14px}
.search{margin:auto;max-width:570px;flex:1;height:36px;border:1px solid var(--wsrt-color-border);background:var(--wsrt-color-surface-subtle);border-radius:8px;color:var(--wsrt-color-text-muted);display:flex;align-items:center;padding:0 12px;text-align:left;cursor:pointer}.search kbd{margin-left:auto;border:1px solid var(--wsrt-color-border);border-radius:4px;background:var(--wsrt-color-surface);padding:2px 6px;font-size:10px}
.actions{display:flex;align-items:center;gap:8px}.pill{border-radius:99px;padding:5px 9px;background:var(--wsrt-color-surface-subtle);border:1px solid var(--wsrt-color-border);font-size:11px}.good{color:var(--wsrt-color-good)}.warn{color:var(--wsrt-color-warning)}
@media(max-width:800px){.menu{display:block}header{gap:8px}.crumbs{min-width:0}.search span{display:none}.search{flex:0 0 48px}.search kbd{display:none}}
`;
