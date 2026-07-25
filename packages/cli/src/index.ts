#!/usr/bin/env node
import { realpathSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { run } from "./cli.js";

export { createWsrtCli, run } from "./cli.js";

if (
	process.argv[1] &&
	realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
	await run();
}
