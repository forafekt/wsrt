import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { WsrtControlPlane } from "@wsrt/control-plane";
import {
	dashboardCancelOperation,
	dashboardOperation,
	dashboardSnapshot,
	safeSerializable,
} from "../api.js";
import { dashboardStyles } from "../client/styles.js";
import { type DashboardOptions, normalizeDashboardOptions } from "../plugin/index.js";
import { validateDashboardContributions } from "../shared/contributions.js";
import { streamSnapshots } from "./snapshots.js";

export type DashboardHandle = {
	url: string;
	host: string;
	port: number;
	basePath: string;
	disconnectClients(): void;
	close(): Promise<void>;
};
const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../client");

export async function startDashboard(
	plane: WsrtControlPlane,
	input: DashboardOptions = {},
): Promise<DashboardHandle> {
	const initialSnapshot = {
		...dashboardSnapshot(plane),
		contributions: await serializedContributions(plane),
	};
	const worker = new Worker(new URL("./dashboard-worker.js", import.meta.url), {
		workerData: { options: normalizeDashboardOptions(input), snapshot: initialSnapshot },
	});
	const ready = new Promise<Omit<DashboardHandle, "disconnectClients" | "close">>(
		(resolve, reject) => {
			worker.on("message", async (message: WorkerMessage) => {
				if (message.type === "ready") resolve(message.handle);
				if (message.type === "command") {
					try {
						const value = await (message.command.type === "cancel"
							? {
									operationId: message.command.operationId,
									cancelled: plane.cancelOperation(message.command.operationId),
								}
							: message.command.type === "contribution"
								? awaitContribution(plane, message.command.contributionId)
								: plane.submit(
										message.command.type,
										message.command.nodeIds,
										message.command.operationId,
									));
						worker.postMessage({ type: "command-result", id: message.id, value });
					} catch (cause) {
						worker.postMessage({
							type: "command-result",
							id: message.id,
							error: cause instanceof Error ? cause.message : String(cause),
						});
					}
				}
			});
			worker.once("error", reject);
			worker.once("exit", (code) => {
				if (code !== 0) reject(new Error(`Dashboard worker exited with code ${code}`));
			});
		},
	);
	const unsubscribe = plane.subscribeSnapshots(() =>
		worker.postMessage({ type: "snapshot", snapshot: dashboardSnapshot(plane) }),
	);
	const handle = await ready;
	let sequence = 0;
	const pending = new Map<number, { resolve(): void; reject(cause: unknown): void }>();
	worker.on("message", (message: WorkerMessage) => {
		if (message.type !== "response") return;
		const waiter = pending.get(message.id);
		if (!waiter) return;
		pending.delete(message.id);
		message.error ? waiter.reject(new Error(message.error)) : waiter.resolve();
	});
	const control = (action: "disconnect" | "close") =>
		new Promise<void>((resolve, reject) => {
			const id = ++sequence;
			pending.set(id, { resolve, reject });
			worker.postMessage({ type: "control", id, action });
		});
	let closed = false;
	return {
		...handle,
		disconnectClients: () => void control("disconnect"),
		async close() {
			if (closed) return;
			closed = true;
			unsubscribe();
			await control("close");
			await worker.terminate();
		},
	};
}

async function serializedContributions(plane: WsrtControlPlane) {
	return validateDashboardContributions(
		await Promise.all(
			plane.pluginContributions("dashboard").map(async (contribution) => {
				try {
					const data = contribution.load
						? await plane.invokePluginContribution("dashboard", contribution.id, (context) =>
								contribution.load?.(context, new AbortController().signal),
							)
						: undefined;
					return safeSerializable({
						...contribution,
						load: undefined,
						run: undefined,
						data,
					});
				} catch (cause) {
					return {
						id: contribution.id,
						kind: contribution.kind,
						title: contribution.title,
						error: cause instanceof Error ? cause.message : String(cause),
					};
				}
			}),
		),
	);
}

export async function startDashboardInProcess(
	plane: WsrtControlPlane,
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
				plane,
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

type WorkerMessage =
	| { type: "ready"; handle: Omit<DashboardHandle, "disconnectClients" | "close"> }
	| {
			type: "command";
			id: number;
			command:
				| {
						type: "start" | "stop" | "restart" | "task";
						operationId: string;
						nodeIds: string[];
				  }
				| { type: "cancel"; operationId: string }
				| { type: "contribution"; contributionId: string };
	  }
	| { type: "response"; id: number; error?: string };

async function awaitContribution(plane: WsrtControlPlane, contributionId: string) {
	const contribution = plane
		.pluginContributions("dashboard")
		.find((item) => item.id === contributionId);
	if (!contribution?.run) throw new Error(`Action ${contributionId} was not found`);
	return plane.invokePluginContribution("dashboard", contributionId, (context) =>
		contribution.run?.({}, context, new AbortController().signal),
	);
}

async function route(
	plane: WsrtControlPlane,
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
			`event: connected\ndata: ${JSON.stringify({ revision: plane.snapshot().revision })}\n\n`,
		);
		let close = () => {};
		close = streamSnapshots(
			plane,
			response,
			lastEventId,
			() => streams.delete(close),
			options.maxSnapshotBytes,
		);
		streams.add(close);
		response.on("close", close);
		return;
	}
	if (relative.startsWith("/api/")) return api(plane, options, method, relative, response);
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
	plane: WsrtControlPlane,
	options: ReturnType<typeof normalizeDashboardOptions>,
	method: string,
	relative: string,
	response: ServerResponse,
) {
	const snapshot = dashboardSnapshot(plane),
		parts = relative.split("/").filter(Boolean),
		resource = parts[1],
		id = parts[2] ? decodeURIComponent(parts[2]) : undefined,
		action = parts[3];
	if (method === "GET") {
		let value: unknown;
		if (resource === "snapshot") value = snapshot;
		else if (resource === "nodes")
			value = id ? nodeDetail(plane, id, snapshot) : snapshot.controlPlane.nodes;
		else if (resource === "operations")
			value = id ? plane.getOperation(id) : plane.listOperations();
		else if (resource === "artifacts")
			value = id ? plane.listArtifacts().find((item) => item.id === id) : plane.listArtifacts();
		else if (resource === "events") value = plane.listEvents().slice(-500);
		else if (resource === "diagnostics") value = snapshot.controlPlane.diagnostics;
		else if (resource === "plugins") value = snapshot.controlPlane.plugins;
		else if (resource === "providers") value = snapshot.controlPlane.providers;
		else if (resource === "configuration") value = safeSerializable(plane.definition());
		else if (resource === "contributions") {
			const contributions = plane.pluginContributions("dashboard");
			value = validateDashboardContributions(
				await Promise.all(
					contributions.map(async (contribution) => {
						try {
							const data = contribution.load
								? await plane.invokePluginContribution("dashboard", contribution.id, (context) =>
										contribution.load?.(context, new AbortController().signal),
									)
								: undefined;
							JSON.stringify(data);
							return { ...contribution, load: undefined, run: undefined, data };
						} catch (cause) {
							return {
								id: contribution.id,
								kind: contribution.kind,
								title: contribution.title,
								error: cause instanceof Error ? cause.message : String(cause),
							};
						}
					}),
				),
			);
		} else return error(response, 404, "dashboard.not_found", "API resource not found");
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
		const contribution = plane
			.pluginContributions("dashboard")
			.find(
				(item) =>
					["action", "command", "artifact-action", "operation-action"].includes(item.kind) &&
					item.id === id,
			);
		if (!contribution?.run)
			return error(response, 404, "dashboard.not_found", `Action ${id} was not found`);
		try {
			const value = await plane.invokePluginContribution("dashboard", id, (context) =>
				contribution.run?.({}, context, new AbortController().signal),
			);
			return json(response, 200, value, options.maxActionResponseBytes);
		} catch (cause) {
			return error(response, 409, "dashboard.action_failed", String(cause));
		}
	}
	if (resource === "nodes" && id && ["start", "stop", "restart"].includes(action ?? ""))
		try {
			return json(
				response,
				202,
				dashboardOperation(plane, action as "start" | "stop" | "restart", [id]),
				options.maxActionResponseBytes,
			);
		} catch (cause) {
			return error(response, 409, "dashboard.operation_failed", String(cause));
		}
	if (resource === "tasks" && id && action === "run")
		try {
			return json(
				response,
				202,
				dashboardOperation(plane, "run", [id]),
				options.maxActionResponseBytes,
			);
		} catch (cause) {
			return error(response, 409, "dashboard.operation_failed", String(cause));
		}
	if (resource === "operations" && id && action === "cancel") {
		const value = dashboardCancelOperation(plane, id);
		return value.cancelled
			? json(response, 202, value, options.maxActionResponseBytes)
			: error(response, 409, "dashboard.not_cancellable", "Operation is not active");
	}
	return error(response, 404, "dashboard.not_found", "Mutation route not found");
}

function nodeDetail(
	plane: WsrtControlPlane,
	id: string,
	snapshot: ReturnType<typeof dashboardSnapshot>,
) {
	const node = snapshot.controlPlane.nodes.find((item) => item.id === id);
	return (
		node && {
			...node,
			graph: plane.getNode(id),
			dependencies: plane.getDependencies(id),
			consumers: plane.getConsumers(id),
			events: plane
				.listEvents()
				.filter((event) => event.source === id)
				.slice(-100),
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
