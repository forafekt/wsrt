import { element } from "../../core/dom.js";
import type { PageContext } from "../page.js";
import { pageFrame } from "../page.js";

export function renderImpactPage(_context: PageContext) {
	return pageFrame(
		"Change impact",
		"Classified, evidence-backed impact for workspace-relative paths. The frontend requests authoritative analysis and does not infer ownership.",
		element(
			"section",
			{ class: "surface empty" },
			"Impact analysis controls are isolated for the next feature pass.",
		),
	);
}
