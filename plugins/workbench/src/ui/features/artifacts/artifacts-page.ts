import { element } from "../../core/dom.js";
import type { PageContext } from "../page.js";
import { inspectableRow, pageFrame, table, tag } from "../page.js";

export function renderArtifactsPage(context: PageContext) {
	const artifacts = context.data?.artifacts ?? [];
	return pageFrame(
		"Artifacts",
		"Declared and confirmed generated artifacts with producer, owner, consumers, paths, related tasks, and evidence.",
		table(
			["Artifact", "Kind", "Location", "Producer", "Availability"],
			artifacts.map((artifact) => {
				const view = artifact as ArtifactView;
				return inspectableRow(
					{ id: view.id, type: "artifact" },
					element(
						"div",
						{},
						element("b", {}, view.name ?? view.id),
						element("small", { class: "mono" }, view.id),
					),
					view.kind ?? view.type ?? "artifact",
					view.path ?? view.location ?? "Declared",
					view.producerId ?? view.producer ?? "-",
					tag(view.available ? "confirmed" : "declared", view.available ? "available" : "partial"),
				);
			}),
		),
	);
}

type ArtifactView = Readonly<{
	id: string;
	name?: string;
	kind?: string;
	type?: string;
	path?: string;
	location?: string;
	producerId?: string;
	producer?: string;
	available?: boolean;
}>;
