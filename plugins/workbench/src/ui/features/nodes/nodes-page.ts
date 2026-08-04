import { element } from "../../core/dom.js";
import type { PageContext } from "../page.js";
import { inspectableRow, pageFrame, table, tag } from "../page.js";

export function renderNodesPage(context: PageContext) {
	const nodes = (context.description?.nodes ?? [])
		.filter((node) => JSON.stringify(node).toLowerCase().includes(context.filter.toLowerCase()))
		.slice(0, 300);
	return pageFrame(
		"Nodes",
		"The central semantic explorer for applications, services, processes, tasks, and artifacts.",
		table(
			["Node", "Kind", "Project", "Lifecycle", "Health", "Files"],
			nodes.map((node) =>
				inspectableRow(
					{ id: node.id, type: "node" },
					element(
						"div",
						{},
						element("b", {}, node.name ?? node.id),
						element("small", { class: "mono" }, node.canonicalId ?? node.id),
					),
					tag(node.kind),
					node.projectId ?? "-",
					element(
						"span",
						{},
						element("span", { class: `dot ${node.lifecycleState ?? ""}` }),
						` ${node.lifecycleState ?? "unknown"}`,
					),
					node.health?.state ?? "unknown",
					String(node.files?.length ?? 0),
				),
			),
		),
	);
}
