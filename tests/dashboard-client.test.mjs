import assert from "node:assert/strict";
import test from "node:test";
import {
	loadLayout,
	matchDashboardRoute,
	reduceDashboardState,
	safeSerializable,
	streamSnapshots,
	validateDashboardContributions,
} from "@wsrt/plugin-dashboard";

test("dashboard routes unknown paths to overview", () => {
	assert.equal(matchDashboardRoute("/operations"), "operations");
	assert.equal(matchDashboardRoute("/tasks"), "tasks");
	assert.equal(matchDashboardRoute("/health"), "health");
	assert.equal(matchDashboardRoute("/providers"), "providers");
	assert.equal(matchDashboardRoute("/workspace"), "workspace");
	assert.equal(matchDashboardRoute("/logs"), "logs");
	assert.equal(matchDashboardRoute("/metrics"), "metrics");
	assert.equal(matchDashboardRoute("/timeline"), "timeline");
	assert.equal(matchDashboardRoute("/not-a-page"), "overview");
});

test("dashboard layout persistence is versioned, bounded, and migratable", () => {
	const valid = loadLayout({
		getItem: () =>
			JSON.stringify({
				version: 1,
				sidebarWidth: 9999,
				inspectorWidth: 100,
				bottomHeight: 300,
				bottomCollapsed: false,
				bottomTab: "events",
			}),
	});
	assert.equal(valid.sidebarWidth, 420);
	assert.equal(valid.inspectorWidth, 280);
	assert.equal(valid.bottomHeight, 300);
	assert.equal(valid.bottomCollapsed, false);
	assert.equal(valid.bottomTab, "events");
	assert.equal(loadLayout({ getItem: () => JSON.stringify({ version: 99 }) }).version, 1);
});

test("dashboard stores plugin view models without mutating interaction state", () => {
	const state = reduceDashboardState(
		{
			eventFilter: "api",
			search: "worker",
			eventsPaused: false,
			connected: true,
			contributions: [],
		},
		{
			type: "contributions",
			value: [{ id: "deployments", kind: "page", data: { ready: true } }],
		},
	);
	assert.equal(state.contributions[0].id, "deployments");
	assert.equal(state.search, "worker");
	assert.equal(Object.isFrozen(state.contributions), true);
});

test("dashboard reducer preserves interaction state across snapshots", () => {
	const selected = reduceDashboardState(
		{
			eventFilter: "failed",
			search: "api",
			eventsPaused: true,
			connected: true,
		},
		{ type: "select-node", id: "api" },
	);
	const hydrated = reduceDashboardState(selected, {
		type: "snapshot",
		snapshot: {
			protocolVersion: 3,
			protocol: { transport: 1, snapshot: 3, contributions: 1, actions: 1, events: 1 },
			revision: 3,
			controlPlane: {},
			graph: {},
			events: [],
			configuration: {},
		},
	});
	assert.equal(hydrated.selectedNode, "api");
	assert.equal(hydrated.eventFilter, "failed");
	assert.equal(hydrated.search, "api");
	assert.equal(hydrated.eventsPaused, true);
});

test("dashboard reducer applies only monotonic snapshot revisions", () => {
	const first = {
		protocolVersion: 3,
		protocol: { transport: 1, snapshot: 3, contributions: 1, actions: 1, events: 1 },
		revision: 2,
		controlPlane: {},
		graph: {},
		events: [],
		configuration: {},
	};
	const stale = { ...first, revision: 1 };
	const state = reduceDashboardState(
		{ eventFilter: "", connected: false },
		{ type: "snapshot", snapshot: first },
	);
	assert.equal(reduceDashboardState(state, { type: "snapshot", snapshot: stale }), state);
});

test("dashboard rejects incompatible protocol snapshots", () => {
	const state = { eventFilter: "", search: "", eventsPaused: false, connected: false };
	assert.equal(
		reduceDashboardState(state, {
			type: "snapshot",
			snapshot: { protocolVersion: 2, revision: 1, controlPlane: {}, events: [] },
		}),
		state,
	);
});

test("paused event inspection remains bounded to its visible revision", () => {
	const base = {
		eventFilter: "",
		search: "",
		eventsPaused: false,
		connected: true,
		contributions: [],
	};
	const first = reduceDashboardState(base, {
		type: "snapshot",
		snapshot: {
			protocolVersion: 3,
			protocol: { transport: 1, snapshot: 3, contributions: 1, actions: 1, events: 1 },
			revision: 1,
			controlPlane: {},
			graph: {},
			events: [{ id: "one" }],
			configuration: {},
		},
	});
	const paused = reduceDashboardState(first, { type: "pause-events", value: true });
	const live = reduceDashboardState(paused, {
		type: "snapshot",
		snapshot: {
			...first.snapshot,
			revision: 2,
			events: [{ id: "one" }, { id: "two" }],
		},
	});
	assert.equal(live.snapshot.revision, 2);
	assert.deepEqual(live.visibleEvents, [{ id: "one" }]);
	assert.deepEqual(
		reduceDashboardState(live, { type: "pause-events", value: false }).visibleEvents,
		[{ id: "one" }, { id: "two" }],
	);
});

test("dashboard serialization redacts secrets and circular values", () => {
	const value = { token: "secret", nested: { password: "hidden" } };
	value.circular = value;
	assert.deepEqual(safeSerializable(value), {
		token: "[REDACTED]",
		nested: { password: "[REDACTED]" },
		circular: "[CIRCULAR]",
	});
});

test("dashboard contribution validation isolates invalid and duplicate payloads", () => {
	const values = validateDashboardContributions([
		{ id: "deploy", kind: "command", title: "Deploy", data: { enabled: true } },
		{ id: "deploy", kind: "command" },
		{ id: "unsafe", kind: "react-component" },
	]);
	assert.equal(values[0].error, undefined);
	assert.match(values[1].error, /Duplicate/);
	assert.match(values[2].error, /Unsupported/);
	assert.equal(Object.isFrozen(values), true);
});

test("dashboard stress fixture remains bounded and indexes contributions promptly", () => {
	const nodes = Array.from({ length: 500 }, (_, index) => ({
		id: `service:${index}`,
		kind: "service",
		state: "running",
		health: "healthy",
	}));
	const events = Array.from({ length: 1_000 }, (_, index) => ({
		id: `event-${index}`,
		type: index % 5 === 0 ? "node.health.checked" : "node.log",
		source: `service:${index % nodes.length}`,
		timestamp: new Date(index * 1000).toISOString(),
		correlationId: `operation-${index % 100}`,
		payload: { index },
	}));
	const operations = Array.from({ length: 100 }, (_, index) => ({
		id: `operation-${index}`,
		status: "completed",
	}));
	const artifacts = Array.from({ length: 500 }, (_, index) => ({
		id: `artifact:${index}`,
		producer: `service:${index}`,
	}));
	const contributions = Array.from({ length: 500 }, (_, index) => ({
		id: `contribution-${index}`,
		kind: index % 2 ? "command" : "metric-panel",
		data: { value: index },
	}));
	const started = performance.now();
	const state = reduceDashboardState(
		{ eventFilter: "", search: "", eventsPaused: false, connected: true, contributions: [] },
		{
			type: "snapshot",
			snapshot: {
				protocolVersion: 3,
				protocol: {
					transport: 1,
					snapshot: 3,
					contributions: 1,
					actions: 1,
					events: 1,
				},
				revision: 1,
				controlPlane: { nodes, operations, artifacts },
				graph: { nodes, edges: [] },
				events,
				configuration: {},
			},
		},
	);
	const validated = validateDashboardContributions(contributions);
	const elapsed = performance.now() - started;
	assert.equal(state.visibleEvents.length, 1_000);
	assert.equal(validated.length, 500);
	assert.ok(elapsed < 1_000, `stress fixture processing took ${elapsed.toFixed(1)}ms`);
});

test("SSE snapshots suppress duplicate revisions and clean up", () => {
	let listener;
	let unsubscribed = false;
	const plane = {
		subscribeSnapshots(value) {
			listener = value;
			value({ revision: 1 });
			return () => {
				unsubscribed = true;
			};
		},
		snapshot: () => ({
			revision: 1,
			workspace: {},
			nodes: [],
			operations: [],
			artifacts: [],
			diagnostics: [],
			events: { size: 0 },
		}),
		definition: () => ({}),
		graph: () => ({ toJSON: () => ({}) }),
		listEvents: () => [],
	};
	const chunks = [];
	const close = streamSnapshots(plane, {
		write: (chunk) => chunks.push(chunk),
		end() {},
	});
	listener({ revision: 1 });
	assert.equal(chunks.filter((chunk) => chunk.includes("event: snapshot")).length, 1);
	close();
	assert.equal(unsubscribed, true);
});

test("SSE oversized snapshots produce one complete typed protocol error frame", () => {
	const plane = {
		subscribeSnapshots(listener) {
			listener({ revision: 1 });
			return () => undefined;
		},
		snapshot: () => ({
			revision: 1,
			workspace: { name: "large" },
			nodes: [],
			operations: [],
			artifacts: [],
			diagnostics: [],
			events: { size: 0 },
		}),
		definition: () => ({ large: "x".repeat(4_000) }),
		graph: () => ({ toJSON: () => ({}) }),
		listEvents: () => [],
	};
	const capture = (limit) => {
		const chunks = [];
		const close = streamSnapshots(
			plane,
			{ write: (chunk) => chunks.push(chunk), end() {} },
			undefined,
			undefined,
			limit,
		);
		close();
		return chunks[0];
	};
	const complete = capture(Number.MAX_SAFE_INTEGER);
	const bytes = Buffer.byteLength(complete);
	assert.match(capture(bytes + 1), /event: snapshot/);
	assert.match(capture(bytes), /event: snapshot/);
	const rejected = capture(bytes - 1);
	assert.match(rejected, /event: protocol-error/);
	assert.match(rejected, /dashboard\.frame_too_large/);
	assert.doesNotMatch(rejected, /x{100}/);
});
