import { element } from "../../core/dom.js";
import type { PageContext } from "../page.js";
import { inspectableRow, pageFrame, table, tag } from "../page.js";

export function renderArchitecturePage(context: PageContext) {
	const nodes = (context.description?.nodes ?? [])
		.filter((node) => ["application", "service", "process"].includes(node.kind))
		.slice(0, 80);
	return pageFrame(
		"Architecture",
		"Bounded, query-driven graph slices distinguish containment, dependencies, production, validation, and readiness.",
		table(
			["Entity", "Kind", "Project", "Lifecycle", "Relationships"],
			nodes.map((node) =>
				inspectableRow(
					{ id: node.id, type: "node" },
					element(
						"div",
						{},
						element("b", {}, node.name ?? node.id),
						element("small", { class: "mono" }, node.id),
					),
					tag(node.kind),
					node.projectId ?? "-",
					node.lifecycleState ?? "unknown",
					String(
						(context.description?.relationships ?? []).filter(
							(edge) => edge.from === node.id || edge.to === node.id,
						).length,
					),
				),
			),
		),
	);
}
