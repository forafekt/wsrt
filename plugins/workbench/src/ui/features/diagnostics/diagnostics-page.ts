import { element } from "../../core/dom.js";
import type { PageContext } from "../page.js";
import { pageFrame, tag } from "../page.js";

export function renderDiagnosticsPage(context: PageContext) {
	const diagnostics = diagnosticList(context.data?.diagnostics).filter((diagnostic) =>
		JSON.stringify(diagnostic).toLowerCase().includes(context.filter.toLowerCase()),
	);
	return pageFrame(
		"Diagnostics",
		"Severity, source, entity, code, evidence, and related operation. An empty result is healthy, not an error.",
		element(
			"section",
			{ class: "surface" },
			diagnostics.length
				? element(
						"ul",
						{ class: "compact-list" },
						...diagnostics.map((diagnostic) =>
							element(
								"li",
								{},
								element("span", {
									class: `dot ${diagnostic.severity === "error" ? "unhealthy" : diagnostic.severity === "warning" ? "degraded" : "healthy"}`,
								}),
								element(
									"span",
									{ class: "grow" },
									element("b", {}, diagnostic.message),
									element(
										"small",
										{},
										`${diagnostic.code ?? "diagnostic"} · ${diagnostic.source ?? "workspace"}`,
									),
								),
								tag(diagnostic.severity ?? "info"),
							),
						),
					)
				: element("div", { class: "empty" }, "No diagnostics at this revision."),
		),
	);
}

function diagnosticList(value: unknown): readonly Diagnostic[] {
	if (Array.isArray(value)) return value as readonly Diagnostic[];
	if (
		value &&
		typeof value === "object" &&
		Array.isArray((value as { diagnostics?: unknown[] }).diagnostics)
	)
		return (value as { diagnostics: Diagnostic[] }).diagnostics;
	return [];
}

type Diagnostic = Readonly<{
	message: string;
	code?: string;
	source?: string;
	severity?: string;
}>;
