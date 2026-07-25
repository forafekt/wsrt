import type { DashboardContributionView, DashboardRoute } from "../shared/contracts.js";
import type { DashboardState } from "./state/store.js";

export const contributionRenderers: Readonly<
	Record<DashboardContributionView["kind"], "specialized" | "fallback">
> = Object.freeze({
	page: "specialized",
	navigation: "specialized",
	widget: "specialized",
	command: "specialized",
	action: "specialized",
	inspector: "specialized",
	badge: "specialized",
	"graph-decoration": "specialized",
	"diagnostic-renderer": "specialized",
	"artifact-action": "specialized",
	"operation-action": "specialized",
	"event-renderer": "specialized",
	"metric-panel": "specialized",
	"status-item": "specialized",
	panel: "fallback",
});

export function applyContributionSurfaces(
	root: HTMLElement,
	state: DashboardState,
	route: DashboardRoute,
) {
	for (const item of state.contributions) {
		if (item.kind === "navigation") appendNavigation(root, item);
		else if (item.kind === "status-item") appendStatus(root, item);
		else if (item.kind === "graph-decoration") decorateGraph(root, item);
		else if (
			(item.kind === "widget" && route === "overview") ||
			(item.kind === "metric-panel" && route === "metrics") ||
			(item.kind === "diagnostic-renderer" && route === "diagnostics") ||
			(item.kind === "artifact-action" && route === "artifacts") ||
			(item.kind === "operation-action" && route === "operations") ||
			(item.kind === "event-renderer" && route === "events") ||
			(item.kind === "inspector" && !!state.selectedNode) ||
			(item.kind === "badge" && !!state.selectedNode) ||
			item.kind === "panel"
		)
			appendSurface(root, item, item.kind === "inspector" || item.kind === "badge");
	}
}

function appendNavigation(root: HTMLElement, item: DashboardContributionView) {
	const nav = root.querySelector(".sidebar nav");
	if (!nav || nav.querySelector(`[data-contribution-nav="${cssEscape(item.id)}"]`)) return;
	const link = document.createElement("a");
	link.dataset.contributionNav = item.id;
	link.dataset.route = item.target?.startsWith("ext:")
		? item.target
		: item.target || `ext:${item.id}`;
	link.href = "#";
	link.title = item.description ?? item.title ?? item.id;
	const icon = document.createElement("span");
	icon.className = "nav-icon";
	icon.textContent = "＋";
	const label = document.createElement("span");
	label.className = "nav-label";
	label.textContent = item.title ?? item.id;
	link.append(icon, label);
	nav.append(link);
}
function appendStatus(root: HTMLElement, item: DashboardContributionView) {
	const bar = root.querySelector(".statusbar");
	if (!bar) return;
	const value = document.createElement("span");
	value.className = "contributed-status";
	value.title = item.description ?? item.id;
	value.textContent = `${item.title ?? item.id}${primitive(item.data) ? `: ${String(item.data)}` : ""}`;
	bar.insertBefore(value, bar.querySelector(".status-spacer"));
}
function decorateGraph(root: HTMLElement, item: DashboardContributionView) {
	const data = record(item.data);
	const nodeId = typeof data?.nodeId === "string" ? data.nodeId : item.target;
	if (!nodeId) return;
	const node = [...root.querySelectorAll<SVGGElement>(".graph-node")].find(
		(value) => value.dataset.node === nodeId,
	);
	if (!node) return;
	node.classList.add("contributed-decoration");
	const title =
		node.querySelector("title") ?? document.createElementNS("http://www.w3.org/2000/svg", "title");
	title.textContent = `${item.title ?? item.id}${typeof data?.label === "string" ? `: ${data.label}` : ""}`;
	if (!title.parentNode) node.prepend(title);
}
function appendSurface(root: HTMLElement, item: DashboardContributionView, inspector: boolean) {
	const host = inspector ? root.querySelector(".inspector") : root.querySelector("main");
	if (!host) return;
	let section = host.querySelector<HTMLElement>(
		inspector ? ".contributed-inspector" : `.contributed-${item.kind}`,
	);
	if (!section) {
		section = document.createElement("section");
		section.className = inspector
			? "contribution-surface contributed-inspector"
			: `contribution-surface contributed-${item.kind}`;
		const heading = document.createElement("h2");
		heading.textContent = inspector ? "Plugin inspector" : contributionTitle(item.kind);
		section.append(heading);
		host.append(section);
	}
	section.append(contributionCard(item));
}
function contributionCard(item: DashboardContributionView) {
	const card = document.createElement("article");
	card.className = "contribution-card";
	card.dataset.contributionKind = item.kind;
	const heading = document.createElement("h3");
	heading.textContent = item.title ?? item.id;
	card.append(heading);
	if (item.description) {
		const description = document.createElement("p");
		description.textContent = item.description;
		card.append(description);
	}
	if (item.error) {
		card.classList.add("danger");
		card.setAttribute("role", "alert");
		const error = document.createElement("p");
		error.textContent = item.error;
		card.append(error);
		return card;
	}
	if (item.data !== undefined) {
		const data = document.createElement("pre");
		data.textContent = stringify(item.data);
		card.append(data);
	}
	if (["action", "command", "artifact-action", "operation-action"].includes(item.kind)) {
		const button = document.createElement("button");
		button.dataset.contribution = item.id;
		button.textContent = item.mutation === false ? "Run" : "Run action";
		if (item.mutation !== false) button.className = "primary";
		card.append(button);
	}
	return card;
}
function contributionTitle(kind: DashboardContributionView["kind"]) {
	return `${kind
		.split("-")
		.map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
		.join(" ")} extensions`;
}
function stringify(value: unknown) {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return "Unserializable contribution data";
	}
}
function primitive(value: unknown) {
	return value == null || ["string", "number", "boolean"].includes(typeof value);
}
function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
function cssEscape(value: string) {
	return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, "");
}
