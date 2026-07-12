import http from "node:http";
const port = Number(process.env.PORT ?? 43122);
const server = http.createServer((_request, response) => {
  response.end("web ready");
});
server.listen(port, "127.0.0.1");
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => server.close(() => process.exit(0)));
