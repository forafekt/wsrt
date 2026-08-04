import { element } from "../../core/dom.js";
import type { PageContext } from "../page.js";
import { inspectableRow, pageFrame, table, tag } from "../page.js";

export function renderFilesPage(context: PageContext) {
	const files = (context.description?.nodes ?? [])
		.flatMap((node) => node.files ?? [])
		.filter((file, index, all) => all.findIndex((other) => other.path === file.path) === index)
		.filter((file) => JSON.stringify(file).toLowerCase().includes(context.filter.toLowerCase()))
		.slice(0, 300);
	return pageFrame(
		"Semantic file ownership",
		"Declared exact paths and patterns with roles, owners, confidence, producers, consumers, warnings, and evidence.",
		table(
			["Path or pattern", "Match", "Role", "Owner", "Generated", "Confidence"],
			files.map((file) =>
				inspectableRow(
					{ id: file.path, type: "file" },
					element("span", { class: "mono" }, file.path),
					tag(file.match ?? "declared", file.match === "exact" ? "available" : "partial"),
					file.role ?? "-",
					file.ownerId ?? "-",
					file.generated ? "Generated" : "Declared",
					file.confidence ?? "-",
				),
			),
		),
	);
}
