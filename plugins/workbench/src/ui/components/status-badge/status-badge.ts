import { element } from "../../core/dom.js";
import { defineElement, WorkbenchElement } from "../base.js";

export class StatusBadge extends WorkbenchElement {
	label = "";
	tone: "neutral" | "good" | "warn" | "bad" = "neutral";
	static define() {
		defineElement("wsrt-workbench-status-badge", StatusBadge);
	}
	protected render() {
		return element(
			"span",
			{ class: `badge ${this.tone}` },
			element("style", {}, styles),
			this.label,
		);
	}
}

const styles = `
:host{display:inline-flex}
.badge{border:1px solid var(--wsrt-color-border);border-radius:999px;background:var(--wsrt-color-surface-subtle);color:var(--wsrt-color-text-muted);font-size:11px;line-height:1;padding:6px 9px;white-space:nowrap}
.good{color:var(--wsrt-color-good)}
.warn{color:var(--wsrt-color-warning)}
.bad{color:var(--wsrt-color-danger)}
`;
