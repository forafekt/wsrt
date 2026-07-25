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
	const loadStarted = performance.now();
	await page.goto(dashboard.url);
	await page.getByRole("heading", { name: "Overview" }).waitFor();
	context.diagnostic(`initial dashboard render: ${(performance.now() - loadStarted).toFixed(1)}ms`);
	await assertVisibleText(page, "acceptance-workspace");
	await assertVisibleText(page, "Connected");
	dashboard.disconnectClients();
	await assertVisibleText(page, "Reconnecting");
	fixture.advance();
	await assertVisibleText(page, "revision 2");
	await assertVisibleText(page, "Connected");
	assert.equal(fixture.listeners.size, 1);
	const heapBefore = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
	for (let index = 0; index < 3; index++) {
		dashboard.disconnectClients();
		await assertVisibleText(page, "Reconnecting");
		await assertVisibleText(page, "Connected");
		assert.equal(fixture.listeners.size, 1);
	}
	const heapAfter = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
	context.diagnostic(`three reconnects heap delta: ${heapAfter - heapBefore} bytes`);
	const initialSidebar = await page
		.locator(".app-shell")
		.evaluate((element) => getComputedStyle(element).getPropertyValue("--sidebar"));
	await page.getByRole("button", { name: "Resize explorer" }).press("ArrowRight");
	const resizedSidebar = await page
		.locator(".app-shell")
		.evaluate((element) => getComputedStyle(element).getPropertyValue("--sidebar"));
	assert.notEqual(resizedSidebar, initialSidebar);
	await page.keyboard.press("Control+J");
	await page.getByRole("region", { name: "Runtime tools" }).waitFor();
	await page.getByRole("tab", { name: "Events" }).click();
	await page.reload();
	await page.getByRole("region", { name: "Runtime tools" }).waitFor();
	assert.equal(
		await page.getByRole("tab", { name: "Events" }).getAttribute("aria-selected"),
		"true",
	);
	assert.equal(
		await page
			.locator(".app-shell")
			.evaluate((element) => getComputedStyle(element).getPropertyValue("--sidebar")),
		resizedSidebar,
	);

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
	assert.equal(await page.locator(".virtual-list").getAttribute("data-total"), "1000");
	assert.ok((await page.locator(".virtual-list [role=listitem]").count()) <= 60);
	await page.getByPlaceholder("Search logs or /regex/…").fill("started");
	await page.getByRole("button", { name: "Pause" }).click();
	await page.getByRole("button", { name: "Resume" }).waitFor();
	fixture.advance();
	await assertVisibleText(page, "revision 3");
	assert.equal(await page.locator(".virtual-list").getAttribute("data-total"), "1");
	await page.getByRole("button", { name: "Resume" }).click();
	await page.getByPlaceholder("Search logs or /regex/…").fill("");
	const appendStarted = performance.now();
	fixture.appendEvents(100);
	await page.waitForFunction(
		() => document.querySelector(".virtual-list")?.getAttribute("data-total") === "1000",
	);
	assert.ok((await page.locator(".virtual-list [role=listitem]").count()) <= 60);
	context.diagnostic(
		`append 100 retained events: ${(performance.now() - appendStarted).toFixed(1)}ms`,
	);
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
	await assertVisibleText(page, "revision 5");

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

test("rendered 500-node graph filters without expanding virtual record DOM", async (context) => {
	const fixture = createPlaneFixture(500, 500);
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
	const started = performance.now();
	await page.goto(`${dashboard.url}/graph`);
	await page.getByLabel("Interactive system graph").waitFor();
	const graphRenderMs = performance.now() - started;
	assert.equal(await page.locator(".graph-node").count(), 500);
	const filterStarted = performance.now();
	await page.getByPlaceholder("Node or runtime").fill("service:499");
	await page.waitForFunction(() => document.querySelectorAll(".graph-node").length === 1);
	const filterMs = performance.now() - filterStarted;
	assert.ok(graphRenderMs < 5_000, `graph render took ${graphRenderMs.toFixed(1)}ms`);
	assert.ok(filterMs < 1_000, `graph filter took ${filterMs.toFixed(1)}ms`);
	const paletteStarted = performance.now();
	await page.keyboard.press("Control+K");
	await page.getByRole("dialog", { name: "Command palette" }).waitFor();
	assert.equal(await page.locator("[data-contribution]").count(), 500);
	const contributionMs = performance.now() - paletteStarted;
	assert.ok(
		contributionMs < 1_500,
		`500 contribution commands took ${contributionMs.toFixed(1)}ms`,
	);
	context.diagnostic(`500-node graph render: ${graphRenderMs.toFixed(1)}ms`);
	context.diagnostic(`500-node graph filter: ${filterMs.toFixed(1)}ms`);
	context.diagnostic(`500 contribution command render: ${contributionMs.toFixed(1)}ms`);
});

test("oversized snapshot presents typed recovery guidance", async (context) => {
	const fixture = createPlaneFixture();
	fixture.plane.definition = () => ({ oversized: "x".repeat(8_000) });
	const dashboard = await startDashboard(fixture.plane, {
		host: "127.0.0.1",
		port: 0,
		strictPort: false,
		basePath: "/__wsrt",
		open: false,
		maxSnapshotBytes: 1_024,
	});
	const browser = await chromium.launch({ headless: true });
	context.after(async () => {
		await browser.close();
		await dashboard.close();
	});
	const page = await browser.newPage();
	await page.goto(dashboard.url);
	await page
		.getByText(/exceeds the 1024-byte/i)
		.first()
		.waitFor();
	await assertVisibleText(page, "Adjust dashboard frame limits");
});

async function assertVisibleText(page, value) {
	await page.getByText(value, { exact: false }).first().waitFor();
}

function createPlaneFixture(nodeCount = 2, contributionCount = 0) {
	let revision = 1;
	let cancelled = false;
	const listeners = new Set();
	const nodes =
		nodeCount === 2
			? [
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
				]
			: Array.from({ length: nodeCount }, (_, index) => ({
					id: `service:${index}`,
					kind: "service",
					state: "running",
					health: index % 20 === 0 ? "degraded" : "healthy",
					runtime: "runtime:node",
					pid: 4_000 + index,
					restartCount: 0,
					consecutiveSuccesses: 4,
					consecutiveFailures: 0,
					restartPending: false,
					currentRestartAttempt: 0,
				}));
	const events = Array.from({ length: 1_000 }, (_, index) => ({
		id: `event-${index}`,
		type: index === 999 ? "node.started" : "node.log",
		timestamp: new Date(Date.now() - index * 100).toISOString(),
		source: index % 2 ? "service:api" : "task:build",
		correlationId: `operation-${index % 100}`,
		payload: { index },
	}));
	const operations =
		nodeCount === 2
			? [
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
				]
			: Array.from({ length: 100 }, (_, index) => ({
					id: `operation-${index}`,
					type: "start",
					status: "completed",
					requestedNodes: [`service:${index}`],
					affectedNodes: [`service:${index}`],
					startedAt: new Date().toISOString(),
					completedAt: new Date().toISOString(),
					correlationId: `correlation-${index}`,
					diagnostics: [],
					results: [],
				}));
	const artifacts = Array.from({ length: nodeCount === 2 ? 0 : 500 }, (_, index) => ({
		id: `artifact:${index}`,
		type: "fixture",
		producer: `service:${index}`,
		consumers: [],
		status: "ready",
		metadata: {},
	}));
	const controlSnapshot = () => ({
		revision,
		generatedAt: new Date().toISOString(),
		workspace: { name: "acceptance-workspace", root: "/fixture" },
		nodes,
		operations,
		artifacts,
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
				edges: nodes.slice(1).map((node, index) => ({
					from: node.id,
					to: nodes[index].id,
					kind: "depends-on",
				})),
			}),
		}),
		definition: () => ({ name: "acceptance-workspace", executables: nodes }),
		listEvents: () => events,
		listArtifacts: () => artifacts,
		listOperations: () => operations,
		getOperation: (id) => operations.find((operation) => operation.id === id),
		getNode: (id) => nodes.find((node) => node.id === id),
		getDependencies: () => ["task:build"],
		getConsumers: () => [],
		pluginContributions: () => [
			...(contributionCount
				? Array.from({ length: contributionCount }, (_, index) => ({
						id: `command-${index}`,
						kind: "command",
						title: `Command ${index}`,
						mutation: false,
						run: () => ({ index }),
					}))
				: [
						{
							id: "broken-fixture",
							kind: "page",
							title: "Broken fixture",
							load: () => {
								throw new Error("fixture contribution failure");
							},
						},
					]),
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
		appendEvents(count) {
			for (let index = 0; index < count; index++)
				events.push({
					id: `appended-${revision}-${index}`,
					type: "node.log",
					timestamp: new Date().toISOString(),
					source: "service:api",
					correlationId: `append-${revision}`,
					payload: { index },
				});
			if (events.length > 1_000) events.splice(0, events.length - 1_000);
			revision++;
			for (const listener of listeners) listener(controlSnapshot());
		},
		listeners,
	};
}
