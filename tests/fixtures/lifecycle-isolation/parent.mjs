import { spawn } from "node:child_process";
import fs from "node:fs";

const child = spawn(process.execPath, [new URL("./descendant.mjs", import.meta.url).pathname], {
	env: process.env,
	stdio: ["ignore", "ignore", "inherit", "ipc"],
});

child.once("message", ({ pid, port }) => {
	fs.writeFileSync(
		process.env.WSRT_TEST_PIDS,
		JSON.stringify({ parentPid: process.pid, descendantPid: pid, port }),
	);
});

child.once("exit", () => process.exit(0));

process.on("SIGTERM", () => {});

setInterval(() => {}, 1000);
