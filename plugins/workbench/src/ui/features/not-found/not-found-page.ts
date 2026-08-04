import { element } from "../../core/dom.js";
import type { PageContext } from "../page.js";
import { pageFrame } from "../page.js";

export function renderNotFoundPage(_context: PageContext) {
	return pageFrame(
		"Route not found",
		"The requested Workbench route is not registered.",
		element(
			"section",
			{ class: "surface empty" },
			"Use the navigation to return to an available workspace view.",
		),
	);
}
