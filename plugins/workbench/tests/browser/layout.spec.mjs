import { expect, test } from "@playwright/test";
import { createWorkbenchServer } from "../../dist/index.js";

let handle;

test.beforeAll(async () => {
	handle = await createWorkbenchServer(fakeWorkspaceClient(), { port: 0 });
});

test.afterAll(async () => {
	await handle?.close();
});

test.beforeEach(async ({ page }) => {
	const consoleErrors = [];
	const failedRequests = [];
	page.on("console", (message) => {
		if (message.type() === "error") consoleErrors.push(message.text());
	});
	page.on("requestfailed", (request) => {
		failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`);
	});
	page.on("pageerror", (error) => {
		consoleErrors.push(error.message);
	});
	page.__workbenchErrors = consoleErrors;
	page.__workbenchFailedRequests = failedRequests;
});

test.afterEach(async ({ page }) => {
	expect(page.__workbenchErrors).toEqual([]);
	expect(page.__workbenchFailedRequests).toEqual([]);
});

test("route viewport supports wheel and keyboard vertical scrolling with inspector open", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto(`${handle.url}/nodes`);
	await expect(page.locator("wsrt-workbench-app")).toBeVisible();
	const viewport = page.locator("wsrt-workbench-app-shell").locator(".route-viewport");
	await expect(viewport).toBeVisible();
	await expect
		.poll(() => viewport.evaluate((node) => node.scrollHeight > node.clientHeight))
		.toBe(true);

	const initial = await viewport.evaluate((node) => node.scrollTop);
	await viewport.hover();
	await page.mouse.wheel(0, 900);
	await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBeGreaterThan(initial);

	await viewport.press("Home");
	await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBe(0);
	await viewport.press("PageDown");
	await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
	await viewport.press("End");
	await expect
		.poll(() =>
			viewport.evaluate((node) => node.scrollTop + node.clientHeight >= node.scrollHeight - 2),
		)
		.toBe(true);
	await expect(page.getByText("Node 119")).toBeVisible();

	await page.getByText("Node 0").click();
	const inspector = page.locator("wsrt-workbench-inspector").locator("aside");
	await expect(inspector).toBeVisible();
	await expect
		.poll(() => inspector.evaluate((node) => node.scrollHeight > node.clientHeight))
		.toBe(true);
	const inspectorInitial = await inspector.evaluate((node) => node.scrollTop);
	await inspector.hover();
	await page.mouse.wheel(0, 700);
	await expect
		.poll(() => inspector.evaluate((node) => node.scrollTop))
		.toBeGreaterThan(inspectorInitial);
});

for (const viewportSize of [
	{ width: 1440, height: 900 },
	{ width: 1280, height: 800 },
	{ width: 1024, height: 768 },
]) {
	test(`navigation collapse preserves layout at ${viewportSize.width}x${viewportSize.height}`, async ({
		page,
	}) => {
		await page.setViewportSize(viewportSize);
		await page.goto(`${handle.url}/nodes`);
		const shell = page.locator("wsrt-workbench-app-shell");
		const routeViewport = shell.locator(".route-viewport");
		const navigation = page.locator("wsrt-workbench-navigation").locator("aside");
		const collapse = page.locator("wsrt-workbench-navigation").getByRole("button", {
			name: /collapse navigation/i,
		});
		await expect(routeViewport).toBeVisible();
		const expanded = await bounds(routeViewport);
		const navExpanded = await bounds(navigation);

		await collapse.click();
		const collapsed = await bounds(routeViewport);
		const navCollapsed = await bounds(navigation);
		expect(navCollapsed.width).toBeLessThan(navExpanded.width);
		expect(collapsed.width).toBeGreaterThan(expanded.width);
		await expect(
			page.locator("wsrt-workbench-navigation").getByRole("link", { name: /nodes/i }),
		).toBeVisible();
		await assertNoHorizontalPageOverflow(page);

		await collapse.click();
		await expect
			.poll(async () => (await bounds(routeViewport)).width)
			.toBeLessThan(collapsed.width);
		await collapse.click();
		await collapse.click();
		await collapse.click();
		await expect.poll(async () => (await bounds(navigation)).width).toBeLessThan(navExpanded.width);

		await page.reload();
		await expect.poll(async () => (await bounds(navigation)).width).toBeLessThan(navExpanded.width);
		await assertNoHorizontalPageOverflow(page);
	});
}

test("tablet drawer overlays navigation, closes with Escape, and keeps content dimensions", async ({
	page,
}) => {
	await page.setViewportSize({ width: 768, height: 1024 });
	await page.goto(`${handle.url}/nodes`);
	const routeViewport = page.locator("wsrt-workbench-app-shell").locator(".route-viewport");
	await expect(routeViewport).toBeVisible();
	const before = await bounds(routeViewport);
	await page
		.locator("wsrt-workbench-topbar")
		.getByRole("button", { name: /open navigation/i })
		.click();
	await expect(page.locator("wsrt-workbench-app-shell").locator(".mobile-scrim")).toBeVisible();
	await expect(page.locator("wsrt-workbench-navigation")).toBeVisible();
	expect(await bounds(routeViewport)).toEqual(before);
	await page.keyboard.press("Escape");
	await expect(page.locator("wsrt-workbench-app-shell").locator(".mobile-scrim")).toBeHidden();
	await assertNoHorizontalPageOverflow(page);

	await page
		.locator("wsrt-workbench-topbar")
		.getByRole("button", { name: /open navigation/i })
		.click();
	await page.locator("wsrt-workbench-navigation").getByRole("link", { name: /files/i }).click();
	await expect(page).toHaveURL(/\/files$/);
	await expect(page.locator("wsrt-workbench-app-shell").locator(".mobile-scrim")).toBeHidden();
});

async function bounds(locator) {
	const box = await locator.boundingBox();
	if (!box) throw new Error("Element has no bounding box");
	return {
		x: Math.round(box.x),
		y: Math.round(box.y),
		width: Math.round(box.width),
		height: Math.round(box.height),
	};
}

async function assertNoHorizontalPageOverflow(page) {
	const overflow = await page.evaluate(() => {
		const documentElement = document.documentElement;
		return {
			scrollWidth: documentElement.scrollWidth,
			clientWidth: documentElement.clientWidth,
			bodyScrollWidth: document.body.scrollWidth,
			bodyClientWidth: document.body.clientWidth,
		};
	});
	expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
	expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.bodyClientWidth + 1);
}

function fakeWorkspaceClient() {
	const listeners = new Set();
	const nodes = Array.from({ length: 120 }, (_, index) => ({
		id: `service:node-${index}`,
		canonicalId: `service:node-${index}`,
		name: `Node ${index}`,
		kind: index % 5 === 0 ? "application" : index % 3 === 0 ? "process" : "service",
		projectId: `project-${index % 8}`,
		lifecycleState: index % 4 === 0 ? "running" : "stopped",
		health: { state: index % 13 === 0 ? "degraded" : "healthy" },
		runtime: {
			state: index % 4 === 0 ? "running" : "stopped",
			provider: "node",
			processId: 4000 + index,
		},
		providerMetadata: {
			provider: "node",
			urls: [`http://127.0.0.1:${3300 + index}`],
			ports: [3300 + index],
		},
		files: Array.from({ length: 4 }, (_, fileIndex) => ({
			path: `packages/project-${index % 8}/src/node-${index}/file-${fileIndex}.ts`,
			match: fileIndex % 2 === 0 ? "exact" : "pattern",
			role: fileIndex % 2 === 0 ? "source" : "configuration",
			ownerId: `service:node-${index}`,
			generated: false,
			confidence: "high",
		})),
		evidence: Array.from({ length: 30 }, (_, evidenceIndex) => ({
			type: "configuration",
			source: `wsrt.config.ts:${evidenceIndex + 1}`,
			reason: `Evidence record ${evidenceIndex} for Node ${index}`,
		})),
	}));
	const projects = Array.from({ length: 8 }, (_, index) => ({
		id: `project-${index}`,
		name: `Project ${index}`,
		kind: "package",
		root: `packages/project-${index}`,
		private: index % 2 === 0,
		publishable: index % 2 !== 0,
		evidence: [{ type: "manifest", source: "package.json" }],
	}));
	const description = {
		metadata: { protocolVersion: 2, workspaceRevision: 7 },
		result: {
			workspaceRevision: 7,
			generatedAt: new Date().toISOString(),
			workspace: {
				id: "test-workspace",
				name: "Workbench Layout Fixture",
				root: "/tmp/workbench-layout-fixture",
				packageManager: "pnpm",
			},
			nodes,
			projects,
			relationships: nodes.slice(1).map((node, index) => ({
				from: nodes[index].id,
				to: node.id,
				kind: "depends-on",
			})),
			capabilities: [
				{ id: "workspace.describe", available: true },
				{ id: "workspace.node.describe", available: true },
			],
		},
	};
	return {
		describeWorkspace: async () => description,
		getStarted: async () => ({
			result: { importantNodeIds: nodes.slice(0, 8).map((node) => node.id) },
		}),
		snapshot: async () => ({ revision: 7 }),
		operations: async () => [],
		diagnostics: async () => [],
		artifacts: async () => [],
		status: async () => ({ sessionId: "test-session" }),
		handshake: () => ({
			protocolVersion: 2,
			sessionId: "test-session",
			workspaceId: "test-workspace",
			state: "ready",
		}),
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		request: async (request) => {
			if (request.type === "workspace.node.describe") {
				const node = nodes.find((candidate) => candidate.id === request.nodeId) ?? nodes[0];
				return { metadata: { workspaceRevision: 7 }, result: node };
			}
			if (request.type === "workspace.file.owners")
				return {
					metadata: { workspaceRevision: 7 },
					result: {
						files: nodes.flatMap((node) => node.files).filter((file) => file.path === request.path),
					},
				};
			return { metadata: { workspaceRevision: 7 }, result: request.type };
		},
	};
}
