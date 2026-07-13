#!/usr/bin/env node
import process from "node:process";
import { pathToFileURL } from "node:url";
import { run } from "./cli.js";

export { createWsrtCli, run } from "./cli.js";

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	await run();
}
