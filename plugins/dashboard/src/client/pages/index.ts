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
	if (route === "graph") {
		const graph = data.graph as {
				nodes?: { id: string; kind: string }[];
				edges?: { from: string; to: string; kind: string }[];
			},
			nodes = graph.nodes ?? [],
			width = 900,
			height = Math.max(420, Math.ceil(nodes.length / 4) * 150);
		const positions = new Map(
			nodes.map((node, index) => [
				node.id,
				{ x: 130 + (index % 4) * 210, y: 80 + Math.floor(index / 4) * 150 },
			]),
		);
		return `<h1>System graph</h1><div class="graph-tools"><button data-graph="out">−</button><button data-graph="fit">Fit</button><button data-graph="in">+</button></div><div class="graph" tabindex="0" aria-label="Interactive system graph"><svg viewBox="0 0 ${width} ${height}" role="img"><g id="graph-viewport">${(
			graph.edges ?? []
		)
			.map((edge) => {
				const from = positions.get(edge.from),
					to = positions.get(edge.to);
				return from && to
					? `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" class="edge ${escapeHtml(edge.kind)}"><title>${escapeHtml(edge.kind)}</title></line>`
					: "";
			})
			.join("")}${nodes
			.map((node) => {
				const point = positions.get(node.id) ?? { x: 0, y: 0 };
				const state = snapshot.nodes.find((item) => item.id === node.id);
				return `<g class="graph-node" data-node="${escapeHtml(node.id)}" tabindex="0" transform="translate(${point.x - 75} ${point.y - 28})"><rect width="150" height="56" rx="9"></rect><text x="10" y="22">${escapeHtml(node.id)}</text><text x="10" y="42" class="sub">${escapeHtml(state?.health ?? node.kind)}</text></g>`;
			})
			.join("")}</g></svg></div>`;
	}
	if (route === "nodes")
		return `<h1>Nodes</h1><div class="grid">${snapshot.nodes.map((node) => `<button class="node" data-node="${escapeHtml(node.id)}"><b>${escapeHtml(node.id)}</b><span>${escapeHtml(node.state)} · ${escapeHtml(node.health)}</span><small>checks ${node.consecutiveSuccesses}/${node.consecutiveFailures} · restarts ${node.restartCount}</small></button>`).join("")}</div>`;
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
