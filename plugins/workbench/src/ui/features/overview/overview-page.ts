import { element } from "../../core/dom.js";
import type { PageContext } from "../page.js";
import { pageFrame, tag } from "../page.js";

export function renderOverviewPage(context: PageContext) {
	const description = context.description;
	const nodes = description?.nodes ?? [];
	const projects = description?.projects ?? [];
	const counts = nodes.reduce<Record<string, number>>((all, node) => {
		all[node.kind] = (all[node.kind] ?? 0) + 1;
		return all;
	}, {});
	return pageFrame(
		"Understand this workspace",
		`Identity, semantic architecture, capabilities, runtime health, and current activity at revision ${description?.workspaceRevision ?? "-"}.`,
		element(
			"div",
			{ class: "overview-grid" },
			element(
				"section",
				{ class: "surface surface-pad identity" },
				element("span", { class: "eyebrow" }, "Authoritative workspace"),
				element("h2", {}, description?.workspace?.name ?? "Workspace"),
				element("p", { class: "mono" }, description?.workspace?.root ?? ""),
				element(
					"div",
					{ class: "facts" },
					fact("Revision", String(description?.workspaceRevision ?? "-")),
					fact("Projects", String(projects.length)),
					fact("Nodes", String(nodes.length)),
				),
			),
			element(
				"section",
				{ class: "surface surface-pad" },
				element("span", { class: "eyebrow" }, "Capabilities"),
				element(
					"ul",
					{ class: "compact-list" },
					...(description?.capabilities ?? []).map((capability) =>
						element(
							"li",
							{},
							element("span", { class: `dot ${capability.available ? "healthy" : "unhealthy"}` }),
							element(
								"span",
								{ class: "grow" },
								element("b", {}, capability.id),
								element("small", {}, capability.available ? "Available" : "Unavailable"),
							),
							tag(
								capability.available ? "available" : "unavailable",
								capability.available ? "available" : "unavailable",
							),
						),
					),
				),
			),
		),
		element(
			"section",
			{ class: "section" },
			element("div", { class: "section-title" }, element("h2", {}, "Semantic model")),
			element(
				"div",
				{ class: "surface kind-list" },
				...Object.entries(counts)
					.sort((a, b) => b[1] - a[1])
					.map(([kind, count]) =>
						element(
							"div",
							{ class: "kind" },
							element("span", {}, kind),
							element("b", {}, String(count)),
						),
					),
			),
		),
	);
}

function fact(label: string, value: string) {
	return element("div", { class: "fact" }, element("small", {}, label), element("b", {}, value));
}
