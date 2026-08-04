import { dispatch, element, type Renderable } from "../core/dom.js";
import type { InspectTarget } from "../core/events.js";

export type PageContext = Readonly<{
	description?: import("../core/view-model.js").WorkspaceSnapshot;
	data?: import("../core/workspace-session.js").BootstrapPayload;
	filter: string;
	mutable: boolean;
}>;

export function pageFrame(title: string, copy: string, ...children: Renderable[]) {
	return element(
		"section",
		{ class: "page" },
		element(
			"header",
			{ class: "page-head" },
			element(
				"div",
				{},
				element("span", { class: "eyebrow" }, "WSRT Workbench"),
				element("h1", {}, title),
				element("p", {}, copy),
			),
		),
		...children,
	);
}

export function table(headers: readonly string[], rows: readonly HTMLTableRowElement[]) {
	return element(
		"div",
		{ class: "table-wrap" },
		element(
			"table",
			{},
			element(
				"thead",
				{},
				element("tr", {}, ...headers.map((header) => element("th", {}, header))),
			),
			element("tbody", {}, ...rows),
		),
	);
}

export function inspectableRow(target: InspectTarget, ...cells: Renderable[]) {
	const row = element("tr", { tabindex: 0 }, ...cells.map((cell) => element("td", {}, cell)));
	const inspect = () => dispatch(row, "wsrt:inspect", target);
	row.addEventListener("click", inspect);
	row.addEventListener("keydown", (event) => {
		if (event.key === "Enter" || event.key === " ") inspect();
	});
	return row;
}

export function tag(label: string, tone = "") {
	return element("span", { class: `tag ${tone}` }, label);
}
