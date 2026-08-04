import { element } from "../../core/dom.js";
import type { PageContext } from "../page.js";
import { inspectableRow, pageFrame, table, tag } from "../page.js";

export function renderProjectsPage(context: PageContext) {
	const projects = (context.description?.projects ?? []).filter((project) =>
		JSON.stringify(project).toLowerCase().includes(context.filter.toLowerCase()),
	);
	return pageFrame(
		"Projects",
		"Packages and project boundaries, ownership, tasks, artifacts, dependencies, and declared evidence.",
		table(
			["Project", "Kind", "Root", "Visibility", "Evidence"],
			projects.map((project) =>
				inspectableRow(
					{ id: project.id, type: "project" },
					element(
						"div",
						{},
						element("b", {}, project.name),
						element("small", { class: "mono" }, project.id),
					),
					tag(project.kind),
					element("span", { class: "mono" }, project.root),
					project.private ? "Private" : project.publishable ? "Publishable" : "Unspecified",
					String(project.evidence?.length ?? 0),
				),
			),
		),
	);
}
