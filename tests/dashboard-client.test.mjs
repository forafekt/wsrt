import assert from "node:assert/strict";
import test from "node:test";
import { matchDashboardRoute, reduceDashboardState, streamSnapshots } from "@wsrt/plugin-dashboard";

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
