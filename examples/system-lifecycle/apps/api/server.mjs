import http from "node:http";

const port = Number(process.env.PORT ?? 43121);
const server = http.createServer((request, response) => {
	response.writeHead(200, { "content-type": "application/json" });
	response.end(JSON.stringify({ ok: true, path: request.url }));
});
server.listen(port, "127.0.0.1");
for (const signal of ["SIGTERM", "SIGINT"])
	process.on(signal, () => server.close(() => process.exit(0)));
