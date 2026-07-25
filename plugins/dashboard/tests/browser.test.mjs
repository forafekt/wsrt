import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { startDashboard } from "../dist/index.js";

test("rendered dashboard supports primary workbench interactions", async (context) => {
	const fixture = createPlaneFixture();
	const dashboard = await startDashboard(fixture.plane, {
		host: "127.0.0.1",
		port: 0,
		strictPort: false,
		basePath: "/__wsrt",
		open: false,
	});
	const browser = await chromium.launch({ headless: true });
	context.after(async () => {
		await browser.close();
		await dashboard.close();
	});
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
	await page.goto(dashboard.url);
	await page.getByRole("heading", { name: "Overview" }).waitFor();
	await assertVisibleText(page, "acceptance-workspace");
	await assertVisibleText(page, "Connected");

	await page.getByRole("link", { name: "Nodes" }).click();
	await page.getByRole("button", { name: "service:api" }).click();
	await page.getByRole("complementary", { name: "Node inspector" }).waitFor();
	await assertVisibleText(page, "runtime:node");

	await page.keyboard.press("Control+K");
	await page.getByPlaceholder("Search nodes, plugins, operations, artifacts…").fill("Logs");
	await page.locator('.command-menu [data-route="logs"]').evaluate((element) => element.click());
	await page.waitForTimeout(100);
	assert.match(page.url(), /\/logs$/);
	await page.getByRole("heading", { name: "Logs" }).waitFor();
	await page.getByPlaceholder("Search logs or /regex/…").fill("started");
	await page.getByRole("button", { name: "Pause" }).click();
	await page.getByRole("button", { name: "Clear local view" }).click();
	await assertVisibleText(page, "No log-compatible events");

	await page.getByRole("link", { name: "Operations" }).click();
	await page.getByRole("button", { name: "Cancel" }).click();
	await assertVisibleText(page, "Cancellation requested");
	assert.equal(fixture.cancelled, true);

	await page.locator('.sidebar [data-route="events"]').evaluate((element) => element.click());
	await page.getByRole("heading", { name: "Events" }).waitFor();
	assert.match(await page.locator("main").innerHTML(), /toggle-events/);
	fixture.advance();
	await assertVisibleText(page, "revision 2");

	await page.getByRole("link", { name: "Broken fixture" }).click();
	await assertVisibleText(page, "fixture contribution failure");

	await page.getByLabel(/Theme:/).click();
	assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
	await page.getByLabel(/Theme:/).click();
	assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");

	await page.setViewportSize({ width: 390, height: 844 });
	await page.getByRole("button", { name: "Open navigation" }).click();
	await page.getByRole("link", { name: "Graph" }).click();
	await page.getByLabel("Interactive system graph").waitFor();
	assert.equal(
		await page.locator("body").evaluate((element) => element.scrollWidth <= innerWidth),
		true,
	);
});

async function assertVisibleText(page, value) {
	await page.getByText(value, { exact: false }).first().waitFor();
}

function createPlaneFixture() {
	let revision = 1;
	let cancelled = false;
	const listeners = new Set();
	const nodes = [
		{
			id: "service:api",
			kind: "service",
			state: "running",
			health: "healthy",
			runtime: "runtime:node",
			pid: 4242,
			restartCount: 1,
			consecutiveSuccesses: 4,
			consecutiveFailures: 0,
			restartPending: false,
			currentRestartAttempt: 0,
		},
		{
			id: "task:build",
			kind: "task",
			state: "resolved",
			health: "unknown",
			runtime: "runtime:node",
			restartCount: 0,
			consecutiveSuccesses: 0,
			consecutiveFailures: 0,
			restartPending: false,
			currentRestartAttempt: 0,
		},
	];
	const events = [
		{
			id: "event-1",
			type: "node.started",
			timestamp: new Date().toISOString(),
			source: "service:api",
			correlationId: "operation-1",
			payload: { ready: true },
		},
	];
	const operations = [
		{
			id: "operation-running",
			type: "start",
			status: "running",
			requestedNodes: ["service:api"],
			affectedNodes: ["service:api"],
			startedAt: new Date().toISOString(),
			correlationId: "correlation-running",
			diagnostics: [],
			results: [],
		},
	];
	const controlSnapshot = () => ({
		revision,
		generatedAt: new Date().toISOString(),
		workspace: { name: "acceptance-workspace", root: "/fixture" },
		nodes,
		operations,
		artifacts: [],
		diagnostics: [],
		events: { size: events.length },
		plugins: [],
		providers: [{ id: "runtime:node", kind: "runtime" }],
	});
	const plane = {
		snapshot: controlSnapshot,
		graph: () => ({
			toJSON: () => ({
				nodes: nodes.map(({ id, kind }) => ({ id, kind })),
				edges: [{ from: "service:api", to: "task:build", kind: "depends-on" }],
			}),
		}),
		definition: () => ({ name: "acceptance-workspace", executables: nodes }),
		listEvents: () => events,
		listArtifacts: () => [],
		listOperations: () => operations,
		getOperation: (id) => operations.find((operation) => operation.id === id),
		getNode: (id) => nodes.find((node) => node.id === id),
		getDependencies: () => ["task:build"],
		getConsumers: () => [],
		pluginContributions: () => [
			{
				id: "broken-fixture",
				kind: "page",
				title: "Broken fixture",
				load: () => {
					throw new Error("fixture contribution failure");
				},
			},
		],
		invokePluginContribution: (_kind, _id, invoke) =>
			invoke({ root: "/fixture" }, new AbortController().signal),
		cancelOperation: () => {
			cancelled = true;
			return true;
		},
		subscribeSnapshots(listener) {
			listeners.add(listener);
			listener(controlSnapshot());
			return () => listeners.delete(listener);
		},
	};
	return {
		plane,
		get cancelled() {
			return cancelled;
		},
		advance() {
			revision++;
			for (const listener of listeners) listener(controlSnapshot());
		},
		listeners,
	};
}
