import { createServer } from "node:http";
import { defineWorkerTasks } from "../dist/worker.js";

let server;
let baseUrl;
let requestCount = 0;

function listen(server, port, host) {
	return new Promise((resolve, reject) => {
		const onError = (error) => {
			server.off("listening", onListening);
			reject(error);
		};
		const onListening = () => {
			server.off("error", onError);
			const address = server.address();
			if (!address || typeof address === "string") {
				reject(new Error("Expected an IP socket address from the worker server"));
				return;
			}
			resolve(address);
		};

		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, host);
	});
}

function close(server) {
	return new Promise((resolve, reject) => {
		server.close((error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

defineWorkerTasks({
	async startServer(input) {
		if (server && baseUrl) return { baseUrl };

		requestCount = 0;
		server = createServer((request, response) => {
			requestCount += 1;

			if (request.url === "/health") {
				response.writeHead(200, { "content-type": "application/json" });
				response.end(JSON.stringify({ ok: true, requestCount }));
				return;
			}

			if (request.url === "/work") {
				response.writeHead(200, { "content-type": "application/json" });
				response.end(
					JSON.stringify({
						pid: process.pid,
						thread: "worker",
						requestCount,
					}),
				);
				return;
			}

			response.writeHead(404, { "content-type": "application/json" });
			response.end(JSON.stringify({ error: "not_found" }));
		});

		const address = await listen(server, input.port ?? 0, input.host ?? "127.0.0.1");
		baseUrl = `http://${address.address}:${address.port}`;
		return { baseUrl };
	},

	async requestServer(input) {
		if (!baseUrl) throw new Error("Server has not been started");

		const response = await fetch(`${baseUrl}${input.path}`);
		return {
			status: response.status,
			body: await response.json(),
		};
	},

	serverStatus() {
		return {
			running: Boolean(baseUrl),
			baseUrl,
			requestCount,
		};
	},

	async stopServer() {
		if (!server) return { stopped: true };

		await close(server);
		server = undefined;
		baseUrl = undefined;
		requestCount = 0;
		return { stopped: true };
	},
});
