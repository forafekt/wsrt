import type { DashboardRoute } from "../../shared/contracts.js";
import type { DashboardState } from "../state/store.js";

export const escapeHtml = (value: unknown) =>
	String(value ?? "").replace(
		/[&<>"']/g,
		(character) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				character
			] ?? character,
	);
const tone = (value: unknown) => {
	const text = String(value ?? "unknown").toLowerCase();
	if (/healthy|running|completed|ready|unchanged|success/.test(text))
		return "success";
	if (/failed|unhealthy|invalid|error|cancelled/.test(text)) return "danger";
	if (/degraded|warning|partial|stopping|pending|generating/.test(text))
		return "warning";
	return "neutral";
};
const badge = (value: unknown) =>
	`<span class="badge ${tone(value)}">${escapeHtml(value ?? "unknown")}</span>`;
const empty = (title: string, detail: string) =>
	`<div class="empty"><span class="empty-icon">◇</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p></div>`;
const duration = (start?: string, end?: string) => {
	if (!start) return "—";
	const ms = new Date(end ?? Date.now()).getTime() - new Date(start).getTime();
	return ms < 1000
		? `${ms} ms`
		: ms < 60000
			? `${Math.round(ms / 100) / 10} s`
			: `${Math.round(ms / 60000)} min`;
};
const time = (value?: string) =>
	value
		? `<time datetime="${escapeHtml(value)}" title="${escapeHtml(value)}">${escapeHtml(new Date(value).toLocaleString())}</time>`
		: "—";
const table = (
	title: string,
	headers: string[],
	rows: string[][],
	emptyText = "No data is available yet.",
) =>
	`<section class="section"><div class="section-heading"><h2>${escapeHtml(title)}</h2><span class="count">${rows.length}</span></div>${rows.length ? `<div class="table-wrap"><table><thead><tr>${headers.map((item) => `<th scope="col">${escapeHtml(item)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((item) => `<td>${item}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : empty(title, emptyText)}</section>`;
const heading = (title: string, description: string, actions = "") =>
	`<div class="page-heading"><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>${actions}</div>`;

export function renderPage(
	route: DashboardRoute,
	state: DashboardState,
): string {
	const data = state.snapshot;
	const snapshot = data?.controlPlane;
	if (state.error)
		return `<div class="alert danger" role="alert"><b>Dashboard unavailable</b><span>${escapeHtml(state.error)}</span><button data-action="refresh">Try again</button></div>`;
	if (!snapshot)
		return `<div class="skeleton-page" aria-label="Loading"><div></div><div></div><div></div></div>`;
	if (route === "overview") {
		const health = ["healthy", "degraded", "unhealthy", "unknown"].map(
			(value) => [
				value,
				snapshot.nodes.filter((n) => n.health === value).length,
			],
		);
		const active = snapshot.operations.filter(
			(o) => o.status === "running" || o.status === "pending",
		);
		return `${heading("Overview", "Live workspace health and recent control-plane activity.")}<div class="summary-grid"><article class="metric"><span>Nodes</span><strong>${snapshot.nodes.length}</strong><small>${health.map(([k, v]) => `${v} ${k}`).join(" · ")}</small></article><article class="metric"><span>Overall health</span><strong class="${tone(health.find(([k]) => k === "unhealthy")?.[1] ? "unhealthy" : "healthy")}">${health.find(([k]) => k === "unhealthy")?.[1] ? "Attention" : "Operational"}</strong><small>Generated ${time(snapshot.generatedAt)}</small></article><article class="metric"><span>Active operations</span><strong>${active.length}</strong><small>${snapshot.operations.length} total operations</small></article><article class="metric"><span>Artifacts</span><strong>${snapshot.artifacts.length}</strong><small>${snapshot.artifacts.filter((a) => a.status === "failed" || a.status === "invalid").length} need attention</small></article></div><div class="two-column">${table(
			"Lifecycle",
			["State", "Nodes"],
			["running", "starting", "stopping", "stopped", "failed"].map((value) => [
				badge(value),
				String(snapshot.nodes.filter((n) => n.state === value).length),
			]),
		)}${table(
			"Recent activity",
			["Time", "Event", "Source"],
			data.events
				.slice(-8)
				.reverse()
				.map((e) => [
					time(e.timestamp),
					`<code>${escapeHtml(e.type)}</code>`,
					escapeHtml(e.source),
				]),
			"Activity appears here as the system changes.",
		)}</div>`;
	}
	if (route === "workspace") {
		const graph = data.graph as Graph;
		const kinds = [...new Set((graph.nodes ?? []).map((node) => node.kind))];
		return `${heading("Workspace explorer", "Packages, runnable nodes, relationships, imports, and outputs in one searchable model.", `<label class="search"><span class="sr-only">Filter workspace</span><input data-filter="global" value="${escapeHtml(state.search)}" placeholder="Filter workspace…"></label>`)}<div class="explorer-layout"><section class="explorer-tree"><div class="section-heading"><h2>${escapeHtml(snapshot.workspace.name)}</h2><span class="count">${graph.nodes?.length ?? 0}</span></div>${kinds
			.map(
				(kind) =>
					`<details open><summary>${escapeHtml(kind)}</summary>${(
						graph.nodes ?? []
					)
						.filter(
							(node) =>
								node.kind === kind &&
								(!state.search ||
									node.id.toLowerCase().includes(state.search.toLowerCase())),
						)
						.map(
							(node) =>
								`<button class="tree-item" data-node="${escapeHtml(node.id)}"><span>◇</span>${escapeHtml(node.id)}</button>`,
						)
						.join("")}</details>`,
			)
			.join(
				"",
			)}</section><section class="relation-panel"><span class="eyebrow">Workspace model</span><h2>${graph.edges?.length ?? 0} relationships</h2><p>Select a package or node to inspect it across the graph and node explorer.</p>${table(
			"Relationships",
			["From", "Relation", "To"],
			(graph.edges ?? [])
				.slice(0, 100)
				.map((edge) => [
					escapeHtml(edge.from),
					badge(edge.kind),
					escapeHtml(edge.to),
				]),
		)}</section></div>`;
	}
	if (route === "graph")
		return renderGraph(data.graph as Graph, snapshot.nodes, state.selectedNode);
	if (route === "nodes")
		return `${heading("Nodes", "Processes, services, and tasks in the active system.", `<label class="search"><span class="sr-only">Search nodes</span><input data-filter="global" value="${escapeHtml(state.search)}" placeholder="Search nodes…"></label>`)}${table(
			"All nodes",
			[
				"Node",
				"Kind",
				"Lifecycle",
				"Health",
				"Runtime",
				"PID",
				"Restarts",
				"Actions",
			],
			snapshot.nodes
				.filter(
					(n) =>
						!state.search ||
						`${n.id} ${n.kind} ${n.runtime}`
							.toLowerCase()
							.includes(state.search.toLowerCase()),
				)
				.map((n) => [
					`<button class="link" data-node="${escapeHtml(n.id)}">${escapeHtml(n.id)}</button>`,
					escapeHtml(n.kind),
					badge(n.state),
					badge(n.health),
					escapeHtml(n.runtime ?? "—"),
					escapeHtml(n.pid ?? "—"),
					String(n.restartCount),
					`<span class="row-actions"><button data-mutate="start" data-id="${escapeHtml(n.id)}">Start</button><button data-mutate="restart" data-id="${escapeHtml(n.id)}">Restart</button><button class="danger-button" data-mutate="stop" data-id="${escapeHtml(n.id)}">Stop</button></span>`,
				]),
		)}`;
	if (route === "operations")
		return `${heading("Operations", "Track lifecycle work and per-node outcomes.")}${table(
			"Operation history",
			["ID", "Type", "Status", "Targets", "Duration", "Correlation"],
			snapshot.operations
				.slice()
				.reverse()
				.map((o) => [
					`<code>${escapeHtml(o.id)}</code>`,
					escapeHtml(o.type),
					badge(o.status),
					escapeHtml(o.requestedNodes.join(", ") || "—"),
					duration(o.startedAt, o.completedAt),
					`<code>${escapeHtml(o.correlationId)}</code>`,
				]),
			"Operations will appear after a lifecycle action or task run.",
		)}`;
	if (route === "tasks") {
		const tasks = snapshot.nodes.filter((n) => n.kind === "task");
		return `${heading("Tasks", "Runnable work exposed by the authoritative system graph.")}${table(
			"Available tasks",
			["Task", "State", "Health", "Last operation", "Action"],
			tasks.map((n) => {
				const op = snapshot.operations.find(
					(o) => o.type === "task" && o.requestedNodes.includes(n.id),
				);
				return [
					`<b>${escapeHtml(n.id)}</b>`,
					badge(n.state),
					badge(n.health),
					op ? badge(op.status) : "Never run",
					`<button class="primary" data-mutate="run" data-id="${escapeHtml(n.id)}">Run task</button>`,
				];
			}),
			"No task nodes are configured for this workspace.",
		)}`;
	}
	if (route === "artifacts")
		return `${heading("Artifacts", "Produced outputs and their provenance.")}${table(
			"Artifact browser",
			[
				"Artifact",
				"Type",
				"Status",
				"Producer",
				"Consumers",
				"Location",
				"Size",
			],
			snapshot.artifacts.map((a) => [
				`<b>${escapeHtml(a.id)}</b>`,
				escapeHtml(a.type),
				badge(a.status),
				escapeHtml(a.producer ?? "—"),
				escapeHtml(a.consumers.join(", ") || "—"),
				a.location
					? `<span class="copyable">${escapeHtml(a.location)}<button data-copy="${escapeHtml(a.location)}" aria-label="Copy artifact location">Copy</button></span>`
					: "—",
				a.size == null ? "—" : `${Math.round(a.size / 1024)} KB`,
			]),
			"Artifacts appear when configured producers expose outputs.",
		)}`;
	if (route === "events") {
		const filter = state.eventFilter.toLowerCase();
		const events = data.events
			.filter(
				(e) =>
					!filter ||
					`${e.type} ${e.source} ${e.correlationId}`
						.toLowerCase()
						.includes(filter),
			)
			.slice(-300)
			.reverse();
		return `${heading("Events", "A stable, inspectable timeline of control-plane activity.", `<button data-action="toggle-events">${state.eventsPaused ? "Resume live" : "Pause live"}</button>`)}<div class="toolbar"><label class="search"><span class="sr-only">Filter events</span><input id="event-filter" value="${escapeHtml(state.eventFilter)}" placeholder="Filter type, source, correlation…"></label>${state.eventsPaused ? badge("Live updates paused") : badge("Live")}</div>${table(
			"Timeline",
			["Time", "Type", "Source", "Correlation"],
			events.map((e) => [
				time(e.timestamp),
				`<code>${escapeHtml(e.type)}</code>`,
				escapeHtml(e.source),
				`<code>${escapeHtml(e.correlationId)}</code>`,
			]),
			filter
				? "No events match the active filter."
				: "Events appear as the workspace changes.",
		)}`;
	}
	if (route === "logs") {
		const filter = state.eventFilter.toLowerCase();
		const logs = data.events
			.filter(
				(event) =>
					!filter || JSON.stringify(event).toLowerCase().includes(filter),
			)
			.slice(-500)
			.reverse();
		return `${heading("Logs", "Unified structured output from nodes, plugins, providers, and operations.", `<button data-action="toggle-events">${state.eventsPaused ? "Resume" : "Pause"}</button>`)}<div class="toolbar"><label class="search"><span class="sr-only">Search logs</span><input id="event-filter" value="${escapeHtml(state.eventFilter)}" placeholder="Search logs or /regex/…"></label>${badge(state.eventsPaused ? "Paused" : "Following")}</div><section class="log-viewer" aria-label="Log stream">${logs.length ? logs.map((event) => `<article><time>${escapeHtml(new Date(event.timestamp).toLocaleTimeString())}</time><b>${escapeHtml(event.source)}</b><code>${escapeHtml(event.type)}</code><span>${escapeHtml(event.correlationId)}</span></article>`).join("") : `<p>No log-compatible events match this filter.</p>`}</section>`;
	}
	if (route === "diagnostics")
		return `${heading("Diagnostics", "Actionable configuration and runtime findings.")}${table(
			"Findings",
			["Severity", "Code", "Message", "Source"],
			snapshot.diagnostics.map((d) => [
				badge(d.severity),
				`<code>${escapeHtml(d.code)}</code>`,
				escapeHtml(d.message),
				escapeHtml(
					d.source
						? `${d.source.file ?? ""}${d.source.path ? ` · ${d.source.path}` : ""}`
						: "—",
				),
			]),
			"No diagnostics. The workspace has no reported findings.",
		)}`;
	if (route === "health")
		return `${heading("Health", "Authoritative node checks and restart signals.")}${table(
			"Node health",
			[
				"Node",
				"Health",
				"Provider",
				"Last check",
				"Successes",
				"Failures",
				"Restart",
			],
			snapshot.nodes.map((n) => [
				`<button class="link" data-node="${escapeHtml(n.id)}">${escapeHtml(n.id)}</button>`,
				badge(n.health),
				escapeHtml(n.healthProviderId ?? "—"),
				time(n.lastCheckAt),
				String(n.consecutiveSuccesses),
				String(n.consecutiveFailures),
				n.restartPending ? badge("pending") : "—",
			]),
		)}`;
	if (route === "plugins")
		return `${heading("Plugins", "Explicitly configured extensions visible in the public snapshot.")}${table(
			"Installed plugins",
			["Plugin ID", "Version", "State", "Capabilities", "Registrations"],
			snapshot.plugins.map((p) => [
				`<code>${escapeHtml(p.id)}</code>`,
				escapeHtml(p.version),
				badge(p.state),
				escapeHtml((p.capabilities ?? []).join(", ") || "—"),
				escapeHtml(
					Object.entries(p.registrations)
						.map(([kind, ids]) => `${kind}: ${ids.join(", ")}`)
						.join("; ") || "—",
				),
			]),
			"No plugins are reported by this workspace.",
		)}`;
	if (route === "providers")
		return `${heading("Providers", "Runtime capabilities registered with the control plane.")}${table(
			"Runtime providers",
			["Provider ID", "Kind", "Status"],
			snapshot.providers.map((p) => [
				`<code>${escapeHtml(p.id)}</code>`,
				escapeHtml(p.kind),
				badge("available"),
			]),
			"No providers are reported by this workspace.",
		)}`;
	if (route === "metrics") {
		const running = snapshot.nodes.filter(
			(node) => node.state === "running",
		).length;
		const restarts = snapshot.nodes.reduce(
			(sum, node) => sum + node.restartCount,
			0,
		);
		const failures = snapshot.diagnostics.filter(
			(item) => item.severity === "error",
		).length;
		return `${heading("Metrics", "Lightweight realtime indicators derived from the current public snapshot.")}<div class="summary-grid"><article class="metric"><span>Node availability</span><strong>${snapshot.nodes.length ? Math.round((running / snapshot.nodes.length) * 100) : 100}%</strong><small>${running} currently running</small></article><article class="metric"><span>Restarts</span><strong>${restarts}</strong><small>Across all nodes</small></article><article class="metric"><span>Event throughput</span><strong>${data.events.length}</strong><small>Retained structured events</small></article><article class="metric"><span>Errors</span><strong>${failures}</strong><small>${snapshot.diagnostics.length} total diagnostics</small></article></div>${table(
			"Operation duration",
			["Operation", "Type", "Status", "Duration"],
			snapshot.operations
				.slice(-30)
				.reverse()
				.map((operation) => [
					`<code>${escapeHtml(operation.id)}</code>`,
					escapeHtml(operation.type),
					badge(operation.status),
					duration(operation.startedAt, operation.completedAt),
				]),
		)}`;
	}
	if (route === "timeline") {
		const entries = data.events.slice(-150).reverse();
		return `${heading("Execution timeline", "Correlated workspace activity across lifecycle, health, artifacts, and plugins.")}<div class="timeline" role="list">${entries.map((event) => `<article role="listitem"><div class="timeline-dot ${tone(event.type)}"></div><time>${escapeHtml(new Date(event.timestamp).toLocaleTimeString())}</time><div><b>${escapeHtml(event.type)}</b><p>${escapeHtml(event.source)} · ${escapeHtml(event.correlationId)}</p></div></article>`).join("") || `<p>No timeline events have been recorded.</p>`}</div>`;
	}
	if (route === "settings")
		return `${heading("Settings", "Dashboard preferences stay local to this browser.")}<div class="settings-list"><section><h2>Appearance</h2><p>Cycle system, light, and dark themes from the top bar. Reduced motion and high-contrast system preferences are respected.</p></section><section><h2>Navigation</h2><p>Collapse the desktop sidebar, use the responsive drawer, or press <kbd>Ctrl K</kbd> / <kbd>⌘ K</kbd> anywhere.</p></section><section><h2>Data & privacy</h2><p>The UI consumes immutable snapshots over SSE. Configuration is redacted by the dashboard server and no workspace data is persisted by the dashboard.</p></section></div>`;
	if (route.startsWith("ext:")) {
		const id = route.slice(4),
			contribution = state.contributions.find(
				(item) => item.id === id && item.kind === "page",
			);
		if (!contribution)
			return empty(
				"Plugin page unavailable",
				"The contribution is not registered in the current workspace.",
			);
		return `${heading(contribution.title ?? contribution.id, "Plugin-contributed page rendered from a serializable view model.")}${contribution.error ? `<div class="alert danger" role="alert">${escapeHtml(contribution.error)}</div>` : renderViewModel(contribution.data)}`;
	}
	return `${heading("Configuration", "Effective, normalized, and redacted workspace configuration.")}<div class="toolbar"><button data-copy="${escapeHtml(JSON.stringify(data.configuration, null, 2))}">Copy configuration</button></div><div class="config-explorer">${renderConfig(data.configuration)}</div>`;
}

function renderViewModel(value: unknown): string {
	if (value == null)
		return empty(
			"No contribution data",
			"This plugin page returned an empty view model.",
		);
	if (Array.isArray(value))
		return `<div class="view-grid">${value.map((item) => `<article>${renderViewModel(item)}</article>`).join("")}</div>`;
	if (typeof value === "object")
		return `<dl class="view-model">${Object.entries(
			value as Record<string, unknown>,
		)
			.map(
				([key, item]) =>
					`<div><dt>${escapeHtml(key)}</dt><dd>${typeof item === "object" ? renderViewModel(item) : escapeHtml(item)}</dd></div>`,
			)
			.join("")}</dl>`;
	return `<p>${escapeHtml(value)}</p>`;
}
function renderConfig(value: unknown, path = "workspace"): string {
	if (!value || typeof value !== "object")
		return `<span class="config-value">${escapeHtml(value)}</span>`;
	return Object.entries(value as Record<string, unknown>)
		.map(
			([key, item]) =>
				`<details open><summary><b>${escapeHtml(key)}</b><span class="config-origin">effective · ${escapeHtml(path)}</span></summary><div>${renderConfig(item, `${path}.${key}`)}</div></details>`,
		)
		.join("");
}

type Graph = {
	nodes?: { id: string; kind: string }[];
	edges?: { from: string; to: string; kind: string }[];
};
function renderGraph(
	graph: Graph,
	states: readonly { id: string; health: string; state: string }[],
	selected?: string,
) {
	const nodes = graph.nodes ?? [],
		width = 1000,
		height = Math.max(500, Math.ceil(nodes.length / 4) * 150);
	const positions = new Map(
		nodes.map((node, index) => [
			node.id,
			{ x: 140 + (index % 4) * 240, y: 90 + Math.floor(index / 4) * 150 },
		]),
	);
	return `${heading("System graph", "Explore dependencies without losing selection or viewport during live updates.")}<div class="graph-shell"><div class="graph-tools" aria-label="Graph controls"><button data-graph="out" aria-label="Zoom out">−</button><button data-graph="fit">Fit view</button><button data-graph="reset">Reset</button><button data-graph="in" aria-label="Zoom in">+</button></div><div class="graph" tabindex="0" aria-label="Interactive system graph"><svg viewBox="0 0 ${width} ${height}" role="img"><g id="graph-viewport">${(
		graph.edges ?? []
	)
		.map((edge) => {
			const from = positions.get(edge.from),
				to = positions.get(edge.to);
			return from && to
				? `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" class="edge ${escapeHtml(edge.kind)}"><title>${escapeHtml(edge.from)} to ${escapeHtml(edge.to)}: ${escapeHtml(edge.kind)}</title></line>`
				: "";
		})
		.join("")}${nodes
		.map((node) => {
			const point = positions.get(node.id) ?? { x: 0, y: 0 },
				state = states.find((item) => item.id === node.id);
			return `<g class="graph-node ${selected === node.id ? "selected" : ""} ${tone(state?.health)}" data-node="${escapeHtml(node.id)}" role="button" aria-label="${escapeHtml(node.id)}, ${escapeHtml(state?.state)}, ${escapeHtml(state?.health)}" tabindex="0" transform="translate(${point.x - 85} ${point.y - 32})"><rect width="170" height="64" rx="10"></rect><circle cx="153" cy="17" r="5"></circle><text x="12" y="25">${escapeHtml(node.id)}</text><text x="12" y="47" class="sub">${escapeHtml(node.kind)} · ${escapeHtml(state?.state)}</text></g>`;
		})
		.join(
			"",
		)}</g></svg></div>${selected ? `<aside class="detail-panel"><button class="close" data-action="clear-selection" aria-label="Close details">×</button><span class="eyebrow">Selected node</span><h2>${escapeHtml(selected)}</h2><p>Selection is preserved across snapshot revisions.</p><button data-route="nodes">Open node list</button></aside>` : ""}</div>`;
}
