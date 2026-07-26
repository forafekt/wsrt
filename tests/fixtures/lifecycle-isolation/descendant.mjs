import fs from "node:fs";
import net from "node:net";

const server = net.createServer();

server.listen(Number(process.env.WSRT_TEST_PORT), "127.0.0.1", () => {
	process.send?.({ pid: process.pid, port: server.address().port });
});

process.on("SIGTERM", () => {});

process.on("SIGINT", () => server.close(() => process.exit(0)));

process.on("uncaughtException", (error) => {
	fs.writeFileSync(process.env.WSRT_TEST_PIDS, JSON.stringify({ error: String(error) }));
	process.exit(1);
});
