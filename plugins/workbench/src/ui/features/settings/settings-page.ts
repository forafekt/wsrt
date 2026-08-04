import { element } from "../../core/dom.js";
import type { PageContext } from "../page.js";
import { pageFrame } from "../page.js";

export function renderSettingsPage(context: PageContext) {
	return pageFrame(
		"Settings",
		"Local presentation preferences. These do not mutate authoritative workspace state.",
		element(
			"section",
			{ class: "surface surface-pad" },
			element(
				"dl",
				{},
				row("Mutations", context.mutable ? "Enabled with confirmation" : "Read only"),
				row("Reconnect", "Automatic SSE"),
				row("State authority", "Workspace session host"),
			),
		),
	);
}

function row(label: string, value: string) {
	return element(
		"div",
		{ class: "detail-row" },
		element("dt", {}, label),
		element("dd", {}, value),
	);
}
