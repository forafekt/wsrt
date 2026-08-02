import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { WorkspaceRequest, WorkspaceSessionClient } from "@wsrt/workspace-session";
import { normalizeWorkbenchOptions, type WorkbenchOptions } from "./plugin.js";
import { workbenchClient } from "./ui/client.js";
import { workbenchStyles } from "./ui/styles.js";

export type WorkbenchHandle = Readonly<{
	url: string;
	host: string;
	port: number;
	basePath: string;
	close(): Promise<void>;
}>;

const allowedRequests = new Set([
	"workspace.capabilities",
	"workspace.describe",
	"workspace.get-started",
	"workspace.node.describe",
	"workspace.graph.query",
	"workspace.nodes.query",
	"workspace.files.query",
	"workspace.file.owners",
	"workspace.task.describe",
	"workspace.artifact.describe",
	"workspace.change.impact",
	"workspace.validation.recommend",
	"workspace.command.plan",
	"workspace.command.execute",
	"snapshot.get",
	"operations.get",
	"events.get",
	"artifacts.get",
	"diagnostics.get",
	"session.status",
]);
const mutations = new Set(["workspace.command.execute"]);

export async function startWorkbench(client: WorkspaceSessionClient, input: WorkbenchOptions = {}) {
	return createWorkbenchServer(client, input);
}

export async function createWorkbenchServer(
	client: WorkspaceSessionClient,
	input: WorkbenchOptions = {},
): Promise<WorkbenchHandle> {
	const options = normalizeWorkbenchOptions(input);
	if (!options.enabled) throw new Error("Workbench is disabled");
	if (!loopback(options.host))
		console.warn(
			`WSRT Workbench security warning: ${options.host} is not loopback; use an authenticated reverse proxy.`,
		);
	const streams = new Set<ServerResponse>();
	const server = createServer(
		(request, response) =>
			void route(client, options, streams, request, response).catch((cause) =>
				sendError(response, 500, "workbench.internal", message(cause)),
			),
	);
	let port = options.port;
	try {
		await listen(server, port, options.host);
	} catch (cause) {
		if (options.strictPort || (cause as NodeJS.ErrnoException).code !== "EADDRINUSE")
			throw new Error(`Failed to bind workbench at ${options.host}:${port}: ${message(cause)}`, {
				cause,
			});
		port = 0;
		await listen(server, port, options.host);
	}
	port = (server.address() as AddressInfo).port;
	const url = `http://${options.host.includes(":") ? `[${options.host}]` : options.host}:${port}${options.basePath || "/"}`;
	if (options.open)
		spawn(
			process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open",
			process.platform === "win32" ? ["/c", "start", "", url] : [url],
			{ detached: true, stdio: "ignore" },
		).unref();
	let closed = false;
	return {
		url,
		host: options.host,
		port,
		basePath: options.basePath || "/",
		async close() {
			if (closed) return;
			closed = true;
			for (const stream of streams) stream.end();
			streams.clear();
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		},
	};
}

async function route(
	client: WorkspaceSessionClient,
	options: ReturnType<typeof normalizeWorkbenchOptions>,
	streams: Set<ServerResponse>,
	request: IncomingMessage,
	response: ServerResponse,
) {
	const url = new URL(request.url ?? "/", "http://localhost");
	const base = options.basePath;
	if ((request.url?.length ?? 0) > 8192)
		return sendError(response, 414, "workbench.uri_too_long", "Request URL exceeds 8192 bytes");
	if (base && url.pathname === base) {
		response.writeHead(308, { location: `${base}/${url.search}` });
		return response.end();
	}
	const relative =
		base && url.pathname.startsWith(`${base}/`)
			? url.pathname.slice(base.length)
			: base
				? ""
				: url.pathname;
	if (!relative) return sendError(response, 404, "workbench.not_found", "Route not found");
	if (request.method === "GET" && relative === "/assets/client.js")
		return text(response, "text/javascript; charset=utf-8", workbenchClient);
	if (request.method === "GET" && relative === "/assets/styles.css")
		return text(response, "text/css; charset=utf-8", workbenchStyles);
	if (request.method === "GET" && relative === "/api/bootstrap") {
		const [description, started, snapshot, operations, diagnostics, artifacts, status] =
			await Promise.all([
				client.describeWorkspace(),
				client.getStarted(),
				client.snapshot(),
				client.operations(),
				client.diagnostics(),
				client.artifacts(),
				client.status(),
			]);
		return json(
			response,
			{
				description,
				started,
				snapshot,
				operations,
				diagnostics,
				artifacts,
				status,
				handshake: client.handshake(),
			},
			options.maxResponseBytes,
		);
	}
	if (request.method === "GET" && relative === "/api/events") {
		response.writeHead(200, {
			"content-type": "text/event-stream",
			"cache-control": "no-cache, no-transform",
			connection: "keep-alive",
			"x-content-type-options": "nosniff",
		});
		streams.add(response);
		response.write(`event: connected\ndata: ${JSON.stringify({ revision: 0 })}\n\n`);
		const unsubscribe = client.subscribe((event) => {
			if (!response.writableEnded)
				response.write(`event: workspace\ndata: ${JSON.stringify(event)}\n\n`);
		});
		const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15_000);
		heartbeat.unref?.();
		request.on("close", () => {
			clearInterval(heartbeat);
			unsubscribe();
			streams.delete(response);
		});
		return;
	}
	if (request.method === "POST" && relative === "/api/request") {
		const body = await readBody(request, options.maxRequestBytes);
		const protocolRequest = body as WorkspaceRequest;
		if (
			!protocolRequest ||
			typeof protocolRequest !== "object" ||
			!allowedRequests.has(protocolRequest.type)
		)
			return sendError(
				response,
				400,
				"workbench.request_unsupported",
				"Unsupported workspace operation",
			);
		if (mutations.has(protocolRequest.type) && !options.mutations)
			return sendError(response, 403, "workbench.read_only", "Mutations are disabled");
		return json(response, await client.request(protocolRequest), options.maxResponseBytes);
	}
	if (request.method === "GET" && !relative.startsWith("/api/") && !relative.startsWith("/assets/"))
		return text(response, "text/html; charset=utf-8", html(options));
	return sendError(response, 404, "workbench.not_found", "Route not found");
}

function html(options: ReturnType<typeof normalizeWorkbenchOptions>) {
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="wsrt-base-path" content="${escapeHtml(options.basePath)}"><meta name="wsrt-mutations" content="${options.mutations}"><title>${escapeHtml(options.title)}</title><link rel="stylesheet" href="${options.basePath}/assets/styles.css"></head><body><div id="app"><main class="boot"><i></i><span>Connecting to the authoritative workspace…</span></main></div><script type="module" src="${options.basePath}/assets/client.js"></script></body></html>`;
}
function escapeHtml(value: string) {
	return value.replace(
		/[&"<>]/g,
		(character) =>
			({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[character] ?? character,
	);
}
function text(response: ServerResponse, contentType: string, body: string) {
	response.writeHead(200, {
		"content-type": contentType,
		"cache-control": contentType.startsWith("text/html") ? "no-cache" : "public, max-age=300",
		"x-content-type-options": "nosniff",
	});
	response.end(body);
}
function json(response: ServerResponse, value: unknown, limit: number) {
	const body = JSON.stringify(value);
	if (Buffer.byteLength(body) > limit)
		return sendError(
			response,
			413,
			"workbench.response_too_large",
			`Response exceeds ${limit} bytes`,
		);
	response.writeHead(200, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"x-content-type-options": "nosniff",
	});
	response.end(body);
}
function sendError(response: ServerResponse, status: number, code: string, detail: string) {
	if (response.headersSent) return response.end();
	response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	response.end(JSON.stringify({ error: { code, message: detail, status } }));
}
async function readBody(request: IncomingMessage, limit: number): Promise<unknown> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = Buffer.from(chunk);
		size += buffer.length;
		if (size > limit)
			throw Object.assign(new Error(`Request exceeds ${limit} bytes`), { status: 413 });
		chunks.push(buffer);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw new Error("Request body must be valid JSON");
	}
}
function listen(server: ReturnType<typeof createServer>, port: number, host: string) {
	return new Promise<void>((resolve, reject) => {
		const fail = (cause: Error) => {
			server.off("listening", ready);
			reject(cause);
		};
		const ready = () => {
			server.off("error", fail);
			resolve();
		};
		server.once("error", fail);
		server.once("listening", ready);
		server.listen(port, host);
	});
}
function loopback(host: string) {
	return host === "localhost" || host === "127.0.0.1" || host === "::1";
}
function message(cause: unknown) {
	return cause instanceof Error ? cause.message : String(cause);
}
