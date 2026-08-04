import { element } from "../../core/dom.js";
import type { PageContext } from "../page.js";
import { pageFrame } from "../page.js";

export function renderValidationPage(context: PageContext) {
	return pageFrame(
		"Validation planning",
		"Ordered validation tasks, prerequisites, reasons, evidence, and explicit execution. Nothing runs automatically.",
		element(
			"section",
			{ class: "surface empty" },
			context.mutable
				? "Validation planning controls are ready for the next feature pass."
				: "Workbench is running read-only.",
		),
	);
}
