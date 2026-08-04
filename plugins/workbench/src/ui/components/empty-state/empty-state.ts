import { element } from "../../core/dom.js";
import { defineElement, WorkbenchElement } from "../base.js";

export class EmptyState extends WorkbenchElement {
	heading = "Nothing to show";
	message = "The authoritative workspace returned an empty result.";
	static define() {
		defineElement("wsrt-workbench-empty-state", EmptyState);
	}
	protected render() {
		return element(
			"section",
			{ class: "empty" },
			element("style", {}, styles),
			element("h2", {}, this.heading),
			element("p", {}, this.message),
		);
	}
}

const styles = `
.empty{padding:32px;text-align:center;color:var(--wsrt-color-text-muted)}
h2{margin:0 0 6px;font-size:16px;color:var(--wsrt-color-text)}
p{margin:0}
`;
