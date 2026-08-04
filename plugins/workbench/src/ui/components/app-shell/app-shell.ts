import { element } from "../../core/dom.js";
import type { NavigationMode } from "../../state/layout-state.js";
import { defineElement, WorkbenchElement } from "../base.js";

export class AppShell extends WorkbenchElement {
	navigationMode: NavigationMode = "expanded";
	inspecting = false;
	static define() {
		defineElement("wsrt-workbench-app-shell", AppShell);
	}
	protected render() {
		const inspectorWidth = this.inspecting ? "var(--wsrt-inspector-width-default)" : "0px";
		return element(
			"div",
			{
				class: "shell",
				"data-navigation-mode": this.navigationMode,
				style: `--wsrt-inspector-width:${inspectorWidth}`,
			},
			element("style", {}, styles),
			element("a", { class: "skip", href: "#main" }, "Skip to content"),
			element("button", {
				type: "button",
				class: "mobile-scrim",
				aria: { label: "Close navigation" },
			}),
			element("slot", { name: "navigation" }),
			element("div", { class: "topbar-region" }, element("slot", { name: "topbar" })),
			element(
				"main",
				{ id: "main", class: "main", tabindex: "-1" },
				element("div", { class: "route-viewport", tabindex: "0" }, element("slot")),
			),
			element("slot", { name: "inspector" }),
			element("div", { class: "statusbar-region" }, element("slot", { name: "statusbar" })),
			element("slot", { name: "palette" }),
		);
	}
}

const styles = `
:host{display:block;block-size:100%;min-block-size:0}
.shell{block-size:100%;min-block-size:0;inline-size:100%;min-inline-size:0;display:grid;grid-template-columns:var(--wsrt-navigation-width) minmax(0,1fr) var(--wsrt-inspector-width);grid-template-rows:var(--wsrt-topbar-height) minmax(0,1fr) var(--wsrt-statusbar-height);grid-template-areas:"navigation topbar inspector" "navigation main inspector" "navigation statusbar inspector";overflow:hidden;transition:grid-template-columns var(--wsrt-layout-transition-duration) ease}
.shell[data-navigation-mode=expanded]{--wsrt-navigation-width:var(--wsrt-navigation-width-expanded)}
.shell[data-navigation-mode=collapsed]{--wsrt-navigation-width:var(--wsrt-navigation-width-collapsed)}
.topbar-region{grid-area:topbar;min-inline-size:0;min-block-size:0}
.main{grid-area:main;min-inline-size:0;min-block-size:0;overflow:hidden;padding:0}
.route-viewport{block-size:100%;min-block-size:0;min-inline-size:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;padding:25px 28px 60px;scrollbar-gutter:stable}
.route-viewport:focus{outline:2px solid var(--wsrt-color-accent);outline-offset:-2px}
.statusbar-region{grid-area:statusbar;min-inline-size:0;min-block-size:0}
::slotted(wsrt-workbench-navigation){grid-area:navigation;min-block-size:0;min-inline-size:0}
::slotted(wsrt-workbench-inspector){grid-area:inspector;min-block-size:0;min-inline-size:0}
.skip{position:fixed;top:-50px;left:10px;background:var(--wsrt-color-surface);z-index:99;padding:8px}.skip:focus{top:10px}
.mobile-scrim{display:none}
@media(max-width:1050px){.shell{grid-template-columns:var(--wsrt-navigation-width) minmax(0,1fr) 0}.route-viewport{padding:20px}::slotted(wsrt-workbench-inspector){position:absolute;right:0;top:var(--wsrt-topbar-height);bottom:var(--wsrt-statusbar-height);width:min(var(--wsrt-inspector-width-default),90vw);z-index:4}}
@media(max-width:800px){.shell,.shell[data-navigation-mode=expanded],.shell[data-navigation-mode=collapsed],.shell[data-navigation-mode=drawer]{--wsrt-navigation-width:0px;grid-template-columns:minmax(0,1fr) 0;grid-template-areas:"topbar topbar" "main main" "statusbar statusbar"}.route-viewport{padding:16px}.mobile-scrim{display:block;position:fixed;inset:0;background:#0008;border:0;z-index:4}.shell:not([data-navigation-mode=drawer]) .mobile-scrim{display:none}}
@media(prefers-reduced-motion:reduce){.shell{transition:none}}
`;
