import assert from "node:assert/strict";
import test from "node:test";
import {
	matchDashboardRoute,
	reduceDashboardState,
	streamSnapshots,
} from "@wsrt/plugin-dashboard";

test("dashboard routes unknown paths to overview", () => {
	assert.equal(matchDashboardRoute("/operations"), "operations");
	assert.equal(matchDashboardRoute("/not-a-page"), "overview");
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
	assert.equal(
		reduceDashboardState(state, { type: "snapshot", snapshot: stale }),
		state,
	);
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
	assert.equal(
		chunks.filter((chunk) => chunk.includes("event: snapshot")).length,
		1,
	);
	close();
	assert.equal(unsubscribed, true);
});
