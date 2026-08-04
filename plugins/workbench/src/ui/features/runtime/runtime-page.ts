import { element } from "../../core/dom.js";
import type { PageContext } from "../page.js";
import { inspectableRow, pageFrame, table } from "../page.js";

export function renderRuntimePage(context: PageContext) {
	const nodes = (context.description?.nodes ?? []).filter(
		(node) => node.runtime || node.lifecycleState,
	);
	return pageFrame(
		"Runtime",
		"Current lifecycle, health, readiness, providers, processes, ports, URLs, and safe planning controls.",
		table(
			["Runtime node", "State", "Health", "Provider", "PID", "Endpoints"],
			nodes.map((node) =>
				inspectableRow(
					{ id: node.id, type: "node" },
					element(
						"div",
						{},
						element("b", {}, node.name ?? node.id),
						element("small", { class: "mono" }, node.id),
					),
					node.lifecycleState ?? node.runtime?.state ?? "unknown",
					node.health?.state ?? "unknown",
					node.runtime?.provider ?? node.providerMetadata?.provider ?? "-",
					String(node.runtime?.processId ?? "-"),
					[...(node.providerMetadata?.urls ?? []), ...(node.providerMetadata?.ports ?? [])].join(
						", ",
					) || "-",
				),
			),
		),
	);
}
