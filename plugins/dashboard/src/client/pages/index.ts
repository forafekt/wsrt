import type { DashboardRoute } from "../../shared/contracts.js";
import type { DashboardState } from "../state/store.js";

const escapeHtml = (value: unknown) =>
	String(value ?? "").replace(
		/[&<>"']/g,
		(character) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				character
			] ?? character,
	);
export function renderPage(
	route: DashboardRoute,
	state: DashboardState,
): string {
	const data = state.snapshot,
		snapshot = data?.controlPlane;
	if (!snapshot) return "<p>Loading workspace…</p>";
	if (route === "overview")
		return `<h1>${escapeHtml(snapshot.workspace.name)}</h1><div class="cards"><article><b>${snapshot.nodes.length}</b><span>Nodes</span></article><article><b>${snapshot.operations.length}</b><span>Operations</span></article><article><b>${snapshot.artifacts.length}</b><span>Artifacts</span></article></div>`;
	if (route === "nodes" || route === "graph")
		return `<h1>${route === "graph" ? "Graph" : "Nodes"}</h1><div class="grid">${snapshot.nodes.map((node) => `<button class="node" data-node="${escapeHtml(node.id)}"><b>${escapeHtml(node.id)}</b><span>${escapeHtml(node.state)} · ${escapeHtml(node.health)}</span><small>checks ${node.consecutiveSuccesses}/${node.consecutiveFailures} · restarts ${node.restartCount}</small></button>`).join("")}</div>`;
	if (route === "operations")
		return table(
			["Operation", "Type", "Status"],
			snapshot.operations.map((item) => [item.id, item.type, item.status]),
		);
	if (route === "artifacts")
		return table(
			["Artifact", "Status", "SHA-256", "Producer"],
			snapshot.artifacts.map((item) => [
				item.id,
				item.status,
				item.hash ?? "—",
				item.producer ?? "—",
			]),
		);
	if (route === "events") {
		const filter = state.eventFilter.toLowerCase();
		return `<h1>Events</h1><input id="event-filter" value="${escapeHtml(state.eventFilter)}" placeholder="Filter events">${table(
			["Time", "Type", "Source"],
			data.events
				.filter(
					(item) =>
						!filter ||
						`${item.type} ${item.source}`.toLowerCase().includes(filter),
				)
				.map((item) => [item.timestamp, item.type, item.source]),
		)}`;
	}
	if (route === "diagnostics")
		return table(
			["Severity", "Code", "Message"],
			snapshot.diagnostics.map((item) => [
				item.severity,
				item.code,
				item.message,
			]),
		);
	if (route === "configuration")
		return `<h1>Configuration</h1><pre>${escapeHtml(JSON.stringify(data.configuration, null, 2))}</pre>`;
	return `<h1>Plugins</h1><p>Plugin and provider ownership is exposed by the control-plane snapshot when registrations are present.</p>`;
}
function table(headers: string[], rows: unknown[][]) {
	return `<h1>${escapeHtml(headers[0])}</h1><div class="table"><table><thead><tr>${headers.map((item) => `<th>${escapeHtml(item)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((item) => `<td>${escapeHtml(item)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
