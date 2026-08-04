import { element } from "../../core/dom.js";
import type { PageContext } from "../page.js";
import { pageFrame, tag } from "../page.js";

export function renderOperationsPage(context: PageContext) {
	const operations = context.data?.operations ?? [];
	return pageFrame(
		"Operations",
		"Active and recent authoritative operations with target, progress, correlation, diagnostics, and cancellation state.",
		element(
			"section",
			{ class: "surface" },
			operations.length
				? element(
						"ul",
						{ class: "compact-list" },
						...operations
							.slice()
							.reverse()
							.map((operation) =>
								element(
									"li",
									{ tabindex: 0 },
									element("span", { class: `dot ${operation.status}` }),
									element(
										"span",
										{ class: "grow" },
										element("b", {}, operation.type ?? operation.id),
										element("small", {}, `${operation.id} · ${operation.status}`),
									),
									tag(String((operation as { progress?: unknown }).progress ?? operation.status)),
								),
							),
					)
				: element(
						"div",
						{ class: "empty" },
						"No operations have been recorded. This is a valid idle workspace state.",
					),
		),
	);
}
