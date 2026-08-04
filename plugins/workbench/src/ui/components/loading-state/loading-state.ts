import { element } from "../../core/dom.js";
import { defineElement, WorkbenchElement } from "../base.js";

export class LoadingState extends WorkbenchElement {
	message = "Loading workspace data...";
	static define() {
		defineElement("wsrt-workbench-loading-state", LoadingState);
	}
	protected render() {
		return element(
			"div",
			{ class: "loading", aria: { busy: "true" } },
			element("style", {}, styles),
			element("span", { class: "spinner" }),
			element("span", {}, this.message),
		);
	}
}

const styles = `
.loading{min-height:240px;display:grid;place-content:center;gap:14px;color:var(--wsrt-color-text-muted);text-align:center}
.spinner{width:28px;height:28px;border:2px solid var(--wsrt-color-border);border-top-color:var(--wsrt-color-accent);border-radius:999px;animation:spin .8s linear infinite;margin:auto}
@keyframes spin{to{transform:rotate(360deg)}}
`;
