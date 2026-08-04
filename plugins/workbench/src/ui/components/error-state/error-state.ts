import { dispatch, element } from "../../core/dom.js";
import { defineElement, WorkbenchElement } from "../base.js";

export class ErrorState extends WorkbenchElement {
	message = "Workbench could not load.";
	static define() {
		defineElement("wsrt-workbench-error-state", ErrorState);
	}
	protected render() {
		const button = element("button", { type: "button" }, "Retry");
		button.addEventListener("click", () => dispatch(this, "wsrt:retry", undefined));
		return element(
			"section",
			{ class: "error", role: "alert" },
			element("style", {}, styles),
			element("h2", {}, "Workspace unavailable"),
			element("p", {}, this.message),
			button,
		);
	}
}

const styles = `
.error{padding:24px;border:1px solid var(--wsrt-color-danger-border);background:var(--wsrt-color-danger-surface);border-radius:8px;color:var(--wsrt-color-danger)}
h2{margin:0 0 6px;font-size:16px}
p{margin:0 0 14px}
button{border:1px solid var(--wsrt-color-border);background:var(--wsrt-color-surface);border-radius:7px;height:34px;padding:0 12px}
`;
