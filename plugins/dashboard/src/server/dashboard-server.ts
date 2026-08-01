import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serializeControlPlaneError } from "@wsrt/control-plane";
import { dashboardCancelOperation, dashboardOperation, dashboardSnapshot } from "../api.js";
import type { DashboardBackend } from "../backend.js";
import { dashboardStyles } from "../client/styles.js";
import { type DashboardOptions, normalizeDashboardOptions } from "../plugin/index.js";
import { streamSnapshots } from "./snapshots.js";
import { DashboardTransportError } from "./worker-backend.js";

export type DashboardHandle = {
	url: string;
	host: string;
	port: number;
	basePath: string;
	disconnectClients(): void;
	close(): Promise<void>;
};

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../client");

export async function createDashboardServer(
	backend: DashboardBackend,
	input: DashboardOptions = {},
): Promise<DashboardHandle> {
	const options = normalizeDashboardOptions(input);
	if (!options.enabled) throw new Error("Dashboard is disabled");
	if (!isLoopback(options.host))
		console.warn(
			`WSRT Dashboard security warning: ${options.host} is not loopback. Workspace data and ${options.mutations ? "mutation endpoints" : "read-only endpoints"} will be reachable from the bound network. Use an authenticated reverse proxy.`,
		);
	const streams = new Set<() => void>();
	const server = createServer(async (request, response) => {
		try {
			await route(
				backend,
				options,
				streams,
				request.method ?? "GET",
				request.url ?? "/",
				request.headers["last-event-id"] as string | undefined,
				Number(request.headers["content-length"] ?? 0),
				response,
			);
		} catch (cause) {
			error(
				response,
				500,
				"dashboard.internal",
				cause instanceof Error ? cause.message : String(cause),
			);
		}
	});
	let port = options.port;
	while (true) {
		try {
			await listen(server, port, options.host);
			break;
		} catch (cause) {
			if (options.strictPort || !isAddressInUse(cause))
				throw new Error(
					`Failed to bind dashboard at ${options.host}:${port}: ${cause instanceof Error ? cause.message : String(cause)}`,
					{ cause },
				);
			port = 0;
		}
	}
	const address = server.address();
	if (typeof address === "object" && address) port = address.port;
	const url = `http://${options.host.includes(":") ? `[${options.host}]` : options.host}:${port}${options.basePath || "/"}`;
	if (options.open) openBrowser(url);
	let closed = false;
	return {
		url,
		host: options.host,
		port,
		basePath: options.basePath || "/",
		disconnectClients() {
			for (const close of [...streams]) close();
			streams.clear();
		},
		async close() {
			if (closed) return;
			closed = true;
			for (const close of [...streams]) close();
			streams.clear();
			await new Promise<void>((resolve, reject) =>
				server.close((cause) => (cause ? reject(cause) : resolve())),
			);
		},
	};
}

async function route(
	backend: DashboardBackend,
	options: ReturnType<typeof normalizeDashboardOptions>,
	streams: Set<() => void>,
	method: string,
	rawUrl: string,
	lastEventId: string | undefined,
	contentLength: number,
	response: ServerResponse,
) {
	const url = new URL(rawUrl, "http://localhost"),
		base = options.basePath;
	if (rawUrl.length > 8192)
		return error(response, 414, "dashboard.uri_too_long", "Request URL exceeds 8192 bytes");
	if (!Number.isFinite(contentLength) || contentLength > options.maxRequestBytes)
		return error(
			response,
			413,
			"dashboard.request_too_large",
			`Request exceeds the ${options.maxRequestBytes}-byte limit`,
		);
	if (base && url.pathname === base) {
		response.writeHead(308, { location: `${base}/${url.search}` });
		response.end();
		return;
	}
	if (base && !url.pathname.startsWith(`${base}/`))
		return error(response, 404, "dashboard.not_found", "Route not found");
	const relative = url.pathname.slice(base.length) || "/";
	if (relative === "/api/stream" && method === "GET") {
		response.writeHead(200, {
			"content-type": "text/event-stream",
			"cache-control": "no-cache, no-transform",
			connection: "keep-alive",
			"x-accel-buffering": "no",
		});
		response.write(
			`event: connected\ndata: ${JSON.stringify({ revision: backend.snapshot().revision })}\n\n`,
		);
		let close = () => {};
		close = streamSnapshots(
			backend,
			response,
			lastEventId,
			() => streams.delete(close),
			options.maxSnapshotBytes,
		);
		streams.add(close);
		response.on("close", close);
		return;
	}
	if (relative.startsWith("/api/")) return api(backend, options, method, relative, response);
	if (relative === "/assets/styles.css")
		return textResponse(response, 200, "text/css; charset=utf-8", dashboardStyles);
	if (relative.startsWith("/assets/client/") && relative.endsWith(".js")) {
		const requested = relative.slice("/assets/client/".length),
			target = path.resolve(clientRoot, requested);
		if (!target.startsWith(`${clientRoot}${path.sep}`))
			return error(response, 400, "dashboard.invalid_path", "Invalid asset path");
		try {
			return textResponse(
				response,
				200,
				"text/javascript; charset=utf-8",
				await readFile(target, "utf8"),
			);
		} catch {
			return error(response, 404, "dashboard.asset_not_found", "Asset not found");
		}
	}
	if (method !== "GET")
		return error(response, 405, "dashboard.method_not_allowed", "Method not allowed");
	return textResponse(response, 200, "text/html; charset=utf-8", html(options));
}

async function api(
	backend: DashboardBackend,
	options: ReturnType<typeof normalizeDashboardOptions>,
	method: string,
	relative: string,
	response: ServerResponse,
) {
	const snapshot = dashboardSnapshot(backend),
		parts = relative.split("/").filter(Boolean),
		resource = parts[1],
		id = parts[2] ? decodeURIComponent(parts[2]) : undefined,
		action = parts[3];
	if (method === "GET") {
		let value: unknown;
		if (resource === "snapshot") value = snapshot;
		else if (resource === "nodes")
			value = id ? nodeDetail(id, snapshot) : snapshot.controlPlane.nodes;
		else if (resource === "operations")
			value = id
				? snapshot.controlPlane.operations.find((item) => item.id === id)
				: snapshot.controlPlane.operations;
		else if (resource === "artifacts")
			value = id
				? snapshot.controlPlane.artifacts.find((item) => item.id === id)
				: snapshot.controlPlane.artifacts;
		else if (resource === "events") value = snapshot.events.slice(-500);
		else if (resource === "diagnostics") value = snapshot.controlPlane.diagnostics;
		else if (resource === "plugins") value = snapshot.controlPlane.plugins;
		else if (resource === "providers") value = snapshot.controlPlane.providers;
		else if (resource === "configuration") value = snapshot.configuration;
		else if (resource === "contributions") value = snapshot.contributions;
		else return error(response, 404, "dashboard.not_found", "API resource not found");
		if (id && value === undefined)
			return error(response, 404, "dashboard.not_found", `${resource} ${id} was not found`);
		return json(
			response,
			200,
			value,
			resource === "snapshot" || resource === "configuration"
				? options.maxSnapshotBytes
				: options.maxActionResponseBytes,
		);
	}
	if (method !== "POST")
		return error(response, 405, "dashboard.method_not_allowed", "Method not allowed");
	if (!options.mutations)
		return error(response, 403, "dashboard.read_only", "Dashboard mutations are disabled");
	if (resource === "contributions" && id && action === "run") {
		const contribution = snapshot.contributions.find((item) => item.id === id);
		if (
			!contribution ||
			!["action", "command", "artifact-action", "operation-action"].includes(contribution.kind)
		)
			return error(response, 404, "dashboard.not_found", `Action ${id} was not found`);
		try {
			const value = await backend.runContribution(id);
			return json(response, 200, value, options.maxActionResponseBytes);
		} catch (cause) {
			return commandError(response, cause, "dashboard.action_failed");
		}
	}
	if (resource === "nodes" && id && ["start", "stop", "restart"].includes(action ?? ""))
		try {
			return json(
				response,
				202,
				await dashboardOperation(backend, {
					type: `node.${action}` as "node.start" | "node.stop" | "node.restart",
					nodeIds: [id],
				}),
				options.maxActionResponseBytes,
			);
		} catch (cause) {
			return commandError(response, cause);
		}
	if (resource === "tasks" && id && action === "run")
		try {
			return json(
				response,
				202,
				await dashboardOperation(backend, { type: "task.run", taskId: id }),
				options.maxActionResponseBytes,
			);
		} catch (cause) {
			return commandError(response, cause);
		}
	if (resource === "operations" && id && action === "cancel") {
		const value = await dashboardCancelOperation(backend, {
			type: "operation.cancel",
			operationId: id,
		});
		return value.cancelled
			? json(response, 202, value, options.maxActionResponseBytes)
			: error(response, 409, "dashboard.not_cancellable", "Operation is not active");
	}
	return error(response, 404, "dashboard.not_found", "Mutation route not found");
}

function nodeDetail(id: string, snapshot: ReturnType<typeof dashboardSnapshot>) {
	const node = snapshot.controlPlane.nodes.find((item) => item.id === id);
	const graph = snapshot.graph;
	return (
		node && {
			...node,
			graph: graph.nodes.find((item) => item.id === id),
			dependencies: graph.edges
				.filter((edge) => edge.from === id && edge.kind === "depends-on")
				.map((edge) => graph.nodes.find((item) => item.id === edge.to))
				.filter((item) => item !== undefined),
			consumers: graph.edges
				.filter((edge) => edge.to === id && edge.kind === "depends-on")
				.map((edge) => graph.nodes.find((item) => item.id === edge.from))
				.filter((item) => item !== undefined),
			events: snapshot.events.filter((event) => event.source === id).slice(-100),
		}
	);
}

function html(options: ReturnType<typeof normalizeDashboardOptions>) {
	const base = options.basePath;
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="wsrt-base-path" content="${escapeAttribute(base)}"><meta name="wsrt-mutations" content="${options.mutations}"><title>${escapeAttribute(options.title)}</title><link rel="stylesheet" href="${base}/assets/styles.css"></head><body><div id="app"><main class="boot"><span class="spinner"></span>Loading WSRT Dashboard…</main></div><script type="module" src="${base}/assets/client/main.js"></script></body></html>`;
}

function escapeAttribute(value: string) {
	return value.replace(
		/[&"<>]/g,
		(character) =>
			({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[character] ?? character,
	);
}

function json(response: ServerResponse, status: number, value: unknown, limit = 8 * 1024 * 1024) {
	let body: string;
	try {
		body = JSON.stringify(value);
	} catch {
		return error(
			response,
			500,
			"dashboard.serialization_failed",
			"Response could not be serialized safely",
		);
	}
	if (Buffer.byteLength(body) > limit)
		return error(
			response,
			413,
			"dashboard.frame_too_large",
			`Response exceeds the ${limit}-byte transport limit`,
		);
	textResponse(response, status, "application/json; charset=utf-8", body);
}

function error(response: ServerResponse, status: number, code: string, message: string) {
	json(response, status, { error: { code, message, status } });
}

function commandError(response: ServerResponse, cause: unknown, fallbackCode?: string) {
	if (cause instanceof DashboardTransportError)
		return error(response, 503, cause.code, cause.message);
	const failure = serializeControlPlaneError(cause);
	return error(response, 409, fallbackCode ?? failure.code, failure.message);
}

function textResponse(response: ServerResponse, status: number, type: string, body: string) {
	response.writeHead(status, {
		"content-type": type,
		"cache-control": "no-store",
		"x-content-type-options": "nosniff",
	});
	response.end(body);
}

function listen(server: ReturnType<typeof createServer>, port: number, host: string) {
	return new Promise<void>((resolve, reject) => {
		const fail = (cause: Error) => {
				server.off("listening", ready);
				reject(cause);
			},
			ready = () => {
				server.off("error", fail);
				resolve();
			};
		server.once("error", fail);
		server.once("listening", ready);
		server.listen(port, host);
	});
}

function isAddressInUse(cause: unknown): boolean {
	return !!cause && typeof cause === "object" && "code" in cause && cause.code === "EADDRINUSE";
}

function isLoopback(host: string) {
	return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function openBrowser(url: string) {
	const command =
			process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open",
		args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
	const child = spawn(command, args, { detached: true, stdio: "ignore" });
	child.on("error", (cause) =>
		console.warn(`WSRT Dashboard: could not open browser: ${cause.message}`),
	);
	child.unref();
}
